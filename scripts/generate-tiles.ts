/**
 * Tile Generation Pipeline
 * Converts satellite/raster data into XYZ pyramid tiles
 * Input: Course coordinates (lat, lng, bounds)
 * Output: WebP tiles (z=15-19) uploaded to R2
 */

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import axios from "axios";

interface CourseCoordinates {
  courseId: string;
  name: string;
  lat: number;
  lng: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

interface TileConfig {
  minZoom: number;
  maxZoom: number;
  dataSource: "USDA_NAIP" | "OSM";
  compression: number; // 0-100 (60 = 60% quality)
  format: "webp" | "png";
}

const DEFAULT_CONFIG: TileConfig = {
  minZoom: 15,
  maxZoom: 19,
  dataSource: "USDA_NAIP",
  compression: 60,
  format: "webp",
};

/**
 * Convert geographic coordinates to tile coordinates
 */
function lonLatToTile(lon: number, lat: number, zoom: number): {
  x: number;
  y: number;
  z: number;
} {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n
  );
  return { x, y, z: zoom };
}

/**
 * Generate tile URLs for the given bounds
 */
function generateTileUrls(
  bounds: CourseCoordinates["bounds"],
  config: TileConfig
): Map<number, Array<{ x: number; y: number; z: number; url: string }>> {
  const tileMap = new Map<number, Array<{ x: number; y: number; z: number; url: string }>>();

  for (let z = config.minZoom; z <= config.maxZoom; z++) {
    const northwestTile = lonLatToTile(bounds.west, bounds.north, z);
    const southeastTile = lonLatToTile(bounds.east, bounds.south, z);

    const tiles: Array<{ x: number; y: number; z: number; url: string }> = [];

    for (let x = northwestTile.x; x <= southeastTile.x; x++) {
      for (let y = northwestTile.y; y <= southeastTile.y; y++) {
        // USDA NAIP tile URL format
        const url =
          config.dataSource === "USDA_NAIP"
            ? `https://naip-visualize.nationalmap.gov/arcgis/rest/services/NAIP/NAIP_Imagery/MapServer/tile/${z}/${y}/${x}`
            : `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`;

        tiles.push({ x, y, z, url });
      }
    }

    tileMap.set(z, tiles);
  }

  return tileMap;
}

/**
 * Download and process tile image
 */
async function processTile(
  url: string,
  config: TileConfig
): Promise<Buffer> {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
    const buffer = Buffer.from(response.data);

    // Optimize with sharp
    let processor = sharp(buffer);

    if (config.format === "webp") {
      processor = processor.webp({ quality: config.compression });
    } else {
      processor = processor.png({ compressionLevel: 9 });
    }

    return await processor.toBuffer();
  } catch (error) {
    console.error(`Failed to process tile: ${url}`, error);
    throw error;
  }
}

/**
 * Generate tiles for a course
 */
async function generateCourseTiles(
  course: CourseCoordinates,
  config: TileConfig = DEFAULT_CONFIG,
  outputDir: string = "./tiles"
): Promise<string> {
  console.log(`🗺️  Generating tiles for ${course.name} (${course.courseId})`);
  console.log(`   Zoom levels: ${config.minZoom}-${config.maxZoom}`);
  console.log(`   Data source: ${config.dataSource}`);
  console.log(`   Compression: ${config.compression}% quality`);

  const tileMap = generateTileUrls(course.bounds, config);
  const courseDir = path.join(outputDir, course.courseId);

  // Create output directories
  for (let z = config.minZoom; z <= config.maxZoom; z++) {
    const zDir = path.join(courseDir, String(z));
    fs.mkdirSync(zDir, { recursive: true });
  }

  let totalTiles = 0;
  let processedTiles = 0;

  // Process all tiles
  for (const [zoom, tiles] of tileMap.entries()) {
    totalTiles += tiles.length;
    const zDir = path.join(courseDir, String(zoom));

    for (const tile of tiles) {
      try {
        console.log(`   [${zoom}/${tile.x}/${tile.y}] Downloading...`);
        const buffer = await processTile(tile.url, config);

        const xDir = path.join(zDir, String(tile.x));
        fs.mkdirSync(xDir, { recursive: true });

        const filePath = path.join(xDir, `${tile.y}.${config.format}`);
        fs.writeFileSync(filePath, buffer);

        processedTiles++;
        console.log(
          `   ✓ Tile ${processedTiles}/${totalTiles} saved (${(buffer.length / 1024).toFixed(2)}KB)`
        );
      } catch (error) {
        console.warn(
          `   ✗ Failed to process tile ${tile.z}/${tile.x}/${tile.y}. Continuing...`
        );
      }
    }
  }

  console.log(`✅ Generated ${processedTiles}/${totalTiles} tiles for ${course.name}`);
  return courseDir;
}

/**
 * Batch generate tiles for multiple courses
 */
async function generateMultipleCourses(
  courses: CourseCoordinates[],
  config?: TileConfig
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const course of courses) {
    try {
      const outputPath = await generateCourseTiles(course, config);
      results.set(course.courseId, outputPath);
    } catch (error) {
      console.error(`Failed to generate tiles for ${course.name}:`, error);
    }
  }

  return results;
}

// Export functions for use as module
export {
  generateCourseTiles,
  generateMultipleCourses,
  generateTileUrls,
  processTile,
  lonLatToTile,
  type CourseCoordinates,
  type TileConfig,
};

// CLI usage
if (require.main === module) {
  const exampleCourse: CourseCoordinates = {
    courseId: "pelham-hills",
    name: "Pelham Hills Golf Club",
    lat: 41.1081,
    lng: -73.8295,
    bounds: {
      north: 41.1181,
      south: 41.0981,
      east: -73.8195,
      west: -73.8395,
    },
  };

  generateCourseTiles(exampleCourse)
    .then(() => console.log("🎉 Tile generation complete!"))
    .catch((error) => {
      console.error("❌ Tile generation failed:", error);
      process.exit(1);
    });
}
