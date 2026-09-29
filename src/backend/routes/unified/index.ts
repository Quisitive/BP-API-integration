// ---------------------------------------------------------------------------
// Routes — Unified Barrel Export
// ---------------------------------------------------------------------------
// Mounts all unified correlation sub-routers under
// /api/tenants/:alias/unified/*

import { Router } from 'express';
import alertsRouter from './alerts.js';
import triageRouter from './triage.js';
import correlationsRouter from './correlations.js';
import closeoutsRouter from './closeouts.js';
import auditRouter from './audit.js';
import reportsRouter from './reports.js';
import cisoRouter from './ciso.js';

const router = Router({ mergeParams: true });

router.use('/alerts', alertsRouter);
router.use('/triage', triageRouter);
router.use('/correlations', correlationsRouter);
router.use('/closeouts', closeoutsRouter);
router.use('/audit', auditRouter);
router.use('/reports', cisoRouter);
router.use('/reports', reportsRouter);

export default router;
