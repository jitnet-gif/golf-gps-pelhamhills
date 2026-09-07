import { z } from 'zod';

// Shared type definitions for golf GPS app
// Used by both frontend and backend

// Golf Course schema
export const CourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  country: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  holes: z.number().int().min(1).max(18),
  par: z.number().int().min(36).max(144),
  handicap: z.number().optional(),
  designer: z.string().optional(),
  yearBuilt: z.number().optional(),
  rating: z.number().min(0).max(5).optional(),
});

export type Course = z.infer<typeof CourseSchema>;

// Hole schema
export const HoleSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  handicap: z.number().int().optional(),
  length: z.number().positive(),
  latitude: z.number(),
  longitude: z.number(),
});

export type Hole = z.infer<typeof HoleSchema>;

// Game/Round schema
export const GameSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  playerId: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  scores: z.array(z.number().int().positive()).default([]),
  status: z.enum(['active', 'paused', 'completed']).default('active'),
  totalScore: z.number().int().optional(),
  totalPar: z.number().int().optional(),
  notes: z.string().optional(),
});

export type Game = z.infer<typeof GameSchema>;

// Player schema
export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  handicap: z.number().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Player = z.infer<typeof PlayerSchema>;

// API Response types
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
};

// Error schema for API errors
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  code: z.string().optional(),
  details: z.record(z.string()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
