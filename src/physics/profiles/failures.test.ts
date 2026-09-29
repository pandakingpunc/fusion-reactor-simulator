/**
 * Classification of the errors of the implicit 1.5D attempt (failures.ts): only numerical failures are
 * retried, everything else is a programming error and propagates.
 */
import { describe, expect, it } from 'vitest';
import { GSFailure } from '../equilibrium/gs';
import { SingularMatrixError } from '../numerics/linalg';
import { asLinearAlgebraFailure, isNumericalFailure, LinearAlgebraFailure, NumericalFailure, StepFailure } from './failures';

describe('asLinearAlgebraFailure', () => {
  it('turns the SingularMatrixError of the linear algebra into a LinearAlgebraFailure of the named system', () => {
    const cause = new SingularMatrixError('solveTridiag: sıfır pivot');
    const f = asLinearAlgebraFailure('density', cause);
    expect(f).toBeInstanceOf(LinearAlgebraFailure);
    expect(f).toBeInstanceOf(NumericalFailure);
    expect((f as LinearAlgebraFailure).system).toBe('density');
    expect((f as LinearAlgebraFailure).cause).toBe(cause);
    expect((f as LinearAlgebraFailure).message).toBe('singular density system (solveTridiag: sıfır pivot)');
  });

  it('returns every other error unchanged, plain Errors included (they are not recognised by their class any more)', () => {
    const others: unknown[] = [
      new TypeError('x is not a function'), new RangeError('bad'), new Error('solveTridiag: sıfır pivot'),
      new Error('BandedLU.solve: önce factor()'), new GSFailure('diverged', 'no convergence'), 'text', undefined, null,
    ];
    for (const e of others) expect(asLinearAlgebraFailure('heat', e)).toBe(e);
  });
});

describe('isNumericalFailure', () => {
  it('is true for the typed failures of the numerics and false for programming errors', () => {
    expect(isNumericalFailure(new LinearAlgebraFailure('heat', new SingularMatrixError('tekil')))).toBe(true);
    expect(isNumericalFailure(new StepFailure(1, 1e-3, 4, 'no convergence'))).toBe(true);
    expect(isNumericalFailure(new GSFailure('diverged', 'no convergence'))).toBe(true);
    expect(isNumericalFailure(new TypeError('x is not a function'))).toBe(false);
    expect(isNumericalFailure(new Error('plain'))).toBe(false);
    // the raw error of the linear algebra is converted at the solver, not classified as it comes
    expect(isNumericalFailure(new SingularMatrixError('tekil'))).toBe(false);
  });
});
