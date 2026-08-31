// ---------------------------------------------------------------------------
// Routes — XDR Barrel Export
// ---------------------------------------------------------------------------
// Mounts all XDR sub-routers under /api/tenants/:alias/xdr/*

import { Router } from 'express';
import incidentsRouter from './incidents.js';
import evidenceRouter from './evidence.js';
import remediationRouter from './remediation.js';

const router = Router({ mergeParams: true });

router.use('/incidents', incidentsRouter);
router.use('/evidence', evidenceRouter);
router.use('/remediation', remediationRouter);

export default router;
