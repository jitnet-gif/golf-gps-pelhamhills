import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { HOLE_LAYOUT_SIZE, HOLE_PHOTO_SIZE, holePictures } from '@/data/holeImages';

interface HolePicturesProps {
  holeNumber: number;
  className?: string;
}

/**
 * The hole's aerial photo and layout drawing from the yardage book, small enough
 * for the column beside the map; a tap opens them full screen.
 *
 * A picture that fails to load is dropped rather than shown as a broken image.
 * That is the ordinary case offline: these are cached once seen, so a hole the
 * player has never opened has nothing to show until the phone is back online or
 * the course has been downloaded. Space is held at the pictures' own aspect
 * ratio so the column does not jump as they arrive.
 *
 * Give it `key={holeNumber}` - a failure on one hole must not hide the next.
 */
export const HolePictures: React.FC<HolePicturesProps> = ({ holeNumber, className = '' }) => {
  const pictures = holePictures(holeNumber);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [open, setOpen] = useState(false);

  if (!pictures || (photoFailed && layoutFailed)) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Show hole ${holeNumber} pictures`}
        className={`block w-full rounded-lg overflow-hidden border border-border bg-white ${className}`}
      >
        {!photoFailed && (
          <img
            src={pictures.photo}
            alt=""
            width={HOLE_PHOTO_SIZE.width}
            height={HOLE_PHOTO_SIZE.height}
            onError={() => setPhotoFailed(true)}
            className="block w-full h-auto"
            style={{ aspectRatio: `${HOLE_PHOTO_SIZE.width} / ${HOLE_PHOTO_SIZE.height}` }}
          />
        )}
        {!layoutFailed && (
          <img
            src={pictures.layout}
            alt={`Hole ${holeNumber} layout from the club yardage book`}
            width={HOLE_LAYOUT_SIZE.width}
            height={HOLE_LAYOUT_SIZE.height}
            onError={() => setLayoutFailed(true)}
            className="block w-full h-auto"
            style={{ aspectRatio: `${HOLE_LAYOUT_SIZE.width} / ${HOLE_LAYOUT_SIZE.height}` }}
          />
        )}
      </button>

      {open && (
        <HolePictureViewer
          holeNumber={holeNumber}
          photo={photoFailed ? null : pictures.photo}
          layout={layoutFailed ? null : pictures.layout}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

interface HolePictureViewerProps {
  holeNumber: number;
  photo: string | null;
  layout: string | null;
  onClose: () => void;
}

/**
 * The same two pictures, fitted to one screen. Above the side menu, which on a
 * phone is itself full screen, and above Leaflet's controls.
 *
 * Nothing in it scrolls. The layout drawing is nearly twice as tall as it is
 * wide, and drawn at the screen's width it ran off the bottom - worst in an
 * in-app browser (KakaoTalk's, where the club's links are opened), whose own bars
 * take a good part of the height. So the photo keeps the width and the drawing
 * gets whatever height is left, scaled down whole. It is absolutely positioned
 * inside its slot because object-contain needs a box of a known height, and a
 * flex item's height is only reliably known to its absolutely positioned
 * children. The card is `inset-0` rather than 100vh/100dvh: a fixed box is sized
 * to the visible viewport in every browser, including the older webviews.
 */
const HolePictureViewer: React.FC<HolePictureViewerProps> = ({
  holeNumber,
  photo,
  layout,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Hole ${holeNumber} pictures`}
      onClick={onClose}
      className="fixed inset-0 z-[1200] bg-black/80 flex items-center justify-center sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full h-full max-w-lg flex flex-col bg-card sm:rounded-xl overflow-hidden"
      >
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">Hole {holeNumber}</h2>
            <p className="text-[11px] text-muted-foreground">Pelham Hills yardage book</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close hole pictures"
            className="p-2 -mr-2 rounded-lg hover:bg-accent"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {photo && (
          <img
            src={photo}
            alt={`Hole ${holeNumber} from the air`}
            width={HOLE_PHOTO_SIZE.width}
            height={HOLE_PHOTO_SIZE.height}
            // On a short or sideways screen the strip gives up height to the
            // drawing rather than the other way round.
            className="shrink-0 block w-full h-auto max-h-[28%] object-cover"
          />
        )}
        {layout && (
          <div className="relative flex-1 min-h-0 bg-white">
            <img
              src={layout}
              alt={`Hole ${holeNumber} layout from the club yardage book`}
              width={HOLE_LAYOUT_SIZE.width}
              height={HOLE_LAYOUT_SIZE.height}
              className="absolute inset-0 w-full h-full object-contain p-1"
            />
          </div>
        )}
      </div>
    </div>
  );
};
