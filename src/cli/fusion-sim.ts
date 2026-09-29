#!/usr/bin/env node
/// <reference types="node" />
// Entry point of the fusion-sim command line (`npx tsx src/cli/fusion-sim.ts`; `build/lib/fusion-sim.js` once
// built). All logic is in ./fusionSim/main.ts; process.exitCode (not process.exit) lets pending output drain.
import { main } from './fusionSim/main';

process.exitCode = await main(process.argv.slice(2));
