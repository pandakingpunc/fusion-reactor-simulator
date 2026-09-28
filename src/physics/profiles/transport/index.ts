/**
 * Transport models of the 1.5D model, by ProfileSettings.transportModel. A new closure implements
 * TransportModel in its own file and is registered here.
 */
import type { ProfileSettings } from '../../types';
import { CriticalGradientTransport } from './cgm';
import { ScalingTransport } from './scaling';
import type { TransportModel } from './TransportModel';

export type { TransportModel } from './TransportModel';

export const TRANSPORT_MODELS: Record<ProfileSettings['transportModel'], () => TransportModel> = {
  scaling: () => new ScalingTransport(),
  cgm: () => new CriticalGradientTransport(),
};

export function createTransportModel(id: ProfileSettings['transportModel']): TransportModel {
  const make = TRANSPORT_MODELS[id];
  if (!make) throw new Error(`unknown 1.5D transport model '${id}'`);
  return make();
}
