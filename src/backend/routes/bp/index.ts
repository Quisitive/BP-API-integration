// ---------------------------------------------------------------------------
// Routes — Blackpoint Barrel Export
// ---------------------------------------------------------------------------
// Mounts all BP sub-routers under /api/tenants/:alias/bp/*

import { Router } from 'express';
import detectionsRouter from './detections.js';
import analyticsRouter from './analytics.js';
import reportsRouter from './reports.js';
import assetsRouter from './assets.js';

const router = Router({ mergeParams: true });

router.use('/detections', detectionsRouter);
router.use('/analytics', analyticsRouter);
router.use('/reports', reportsRouter);
router.use('/assets', assetsRouter);

export default router;
