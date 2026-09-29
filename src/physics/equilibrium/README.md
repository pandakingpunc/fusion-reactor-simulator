# Equilibrium: fixed-boundary Grad–Shafranov, boundary shapes, G-EQDSK interchange

Developer note. The physics is described in the module headers; this note says where things live, which
conventions the state is in, and how an equilibrium gets in and out of the solver.

## Layout

| Path | Contents |
| --- | --- |
| `gs.ts` | `GSGrid` (regular (R, Z) grid, Shortley–Weller operator factorised once, exterior fill), `GSSolver.solve` (Picard iteration with Anderson mixing; shape or table profiles), `GSSolver.assemble` (an `Equilibrium` from a state that was not solved here), `surfaceLevels`, the typed `GSFailure` |
| `fluxsurface.ts` | flux-surface tracing from the axis (`traceSurfaces`) and the surface averages of an `Equilibrium`'s tables |
| `miller.ts` | the `ShapeBoundary` interface, `millerBoundary` (up-down symmetric, closed-form crossings), `millerShape` (separate upper and lower δ, κ, ζ; squareness; `Z0`), `shapeIntegrals` |
| `shapes.ts` | `curveBoundary` (any closed curve that every horizontal and vertical line cuts at most twice), `polygonBoundary`, `fourierBoundary` / `fourierCoefficients`, `contourBoundary` (a ψ = const contour of a flux map), `shapeGeometry` |
| `solovev.ts` | analytic Solov'ev / Cerfon–Freidberg equilibria (symmetric and single-null): the exact reference for the tests |
| `greens.ts` | flux and field of a circular current filament (`filamentPsi`, `filamentField`), on Carlson's elliptic integrals (`numerics/elliptic.ts`): the groundwork of a free-boundary solver |
| `../../io/geqdsk.ts` | G-EQDSK writer and reader, COCOS conversion and detection, `equilibriumFromGeqdsk` / `importGeqdsk` |

## The state

ψ [Wb/rad] is positive in the plasma, maximal on the axis, ψ_b = 0 on the boundary; ψ_N = (ψ_axis − ψ)/(ψ_axis − ψ_b).
`Equilibrium.prof` holds the tables on the surfaces `surfaceLevels(nSurf)` (default 101 nodes: ψ_N = s + s² − s³ with
s = (k/(n − 1))², clustered at the edge where q and ⟨|∇ψ|²⟩ follow a boundary layer of width about 1e−3; the old
ψ_N = t² table of 51 nodes had outer-cell metrics up to 14.7 % off). In COCOS terms the solver's state is **COCOS 7** with
I_p, B0 > 0 (σ_Bp = −1, σ_RφZ = +1, σ_ρθφ = +1, ψ in Wb/rad): p′ = dp/dψ > 0, q > 0.

## Boundary shapes

A `ShapeBoundary` answers where a horizontal line (`rRange`) and a vertical line (`zTop`, and `zBottom` for a shape without
up-down symmetry) cross the boundary — exactly, since Shortley–Weller needs the crossings, not samples. A boundary without
`zBottom` / `zRange` is up-down symmetric about Z = 0 and gets the symmetric grid the solver always had (bit for bit); one that
declares them gets a grid over its vertical extent. `curveBoundary` finds the four extremes of a closed curve and inverts each
monotone arc by bisection, which is all a polygon, a Fourier series, the asymmetric Miller curve and a flux contour need.

## Import and export

```ts
import { writeGeqdsk, importGeqdsk } from '../../io/geqdsk';

const text = writeGeqdsk(eq);                              // COCOS 11, 5e16.9; { cocos: 1, nw: 129, nh: 129, digits: 15, limiter } are options
const { eq: imported, notes } = importGeqdsk(text);        // COCOS detected, q re-traced from ψ and F
const inner = importGeqdsk(text, { boundaryPsi: simag + 0.99 * (sibry - simag) }); // boundary on the 99 % surface
```

* The writer puts ψ on the solver's own grid (or resamples it by the bicubic spline of the state), F, p, FF′, p′ and q on a
  uniform ψ_N grid, a closed boundary polygon and an optional limiter. The 5e16.9 format holds 10 significant digits:
  a ψ written and read back agrees to 5e−10 of its range; `digits: 15` gives 1e−14.
* The reader takes what real files do (fields that touch, D exponents, exponents without the E, other header widths, truncated
  files) and reports the oddities as warnings. COCOS is detected from the signs of I_p, B0, ψ_b − ψ_axis and q, and the flux unit
  (Wb or Wb/rad) from Ampère's law on the 98 % surface; σ_RφZ is not in a file, so the odd COCOS is returned. A current or field
  of the other sign is taken by magnitude.
* An imported ψ is resampled onto a Shortley–Weller grid of the boundary polygon; the exterior keeps the file's field. The
  `residual` and `forceBalanceResidual` of an import are those of the ordinary 5-point Δ*, so they measure the file's own
  discretisation (a few 1e−3 for a solver-written file), not the polygon's.
* A boundary that is an X-point separatrix has q → ∞ and |∇ψ| → 0 there: import with `boundaryPsi` on a surface inside it
  (I_p is then the Ampère current of that surface, the profiles are the file's at ψ_N × x_b).
* A boundary polygon is a chord curve: its area and volume are low by about (spacing / radius of curvature)² / 6 (1e−4 at 256 points).

## Not done

Free boundary (the Green's functions are the first brick), a coil-consistent vacuum field in written files (the exterior of ψ is
the solver's smooth continuation), a boundary that is not star-shaped about the axis.
