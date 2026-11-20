<script lang="ts">
  import { familyScheme, type DeviceColorScheme } from '$lib/config/devicePresets';

  // Frame-synchronized XY throttle for angle/radius (handles both together)
  let orbRafId: number | null = null;
  let orbPendingAngle: number | null = null;
  let orbPendingRadius: number | null = null;
  let orbActive = false;

  interface Props {
    angle?: number; // 0-1
    radius?: number; // 0-1
    title?: string;
    onInteraction?: (angle: number, radius: number) => void;
    color?: DeviceColorScheme;
  }

  let {
    angle = 0.5,
    radius = 0.5,
    title = "Orb",
    onInteraction,
    color = familyScheme('utility')
  }: Props = $props();

  let isDragging = $state(false);
  let container: HTMLDivElement;

  // Local state for smooth interaction
  let localAngle = $state(angle);
  let localRadius = $state(radius);

  // Sync from props (props only change on track switch - no observers!)
  $effect(() => {
    localAngle = angle;
    localRadius = radius;
  });

  // Convert angle and radius to cartesian coordinates for display
  const handleX = $derived(50 + localRadius * 40 * Math.cos((localAngle * 360 - 90) * Math.PI / 180));
  const handleY = $derived(50 + localRadius * 40 * Math.sin((localAngle * 360 - 90) * Math.PI / 180));

  function startOrbThrottle() {
    orbActive = true;
    if (!orbRafId) {
      orbRafId = requestAnimationFrame(sendOrbFrame);
    }
  }

  function sendOrbFrame() {
    if (orbPendingAngle !== null && orbPendingRadius !== null && onInteraction) {
      onInteraction(orbPendingAngle, orbPendingRadius);
    }
    orbRafId = null;
    if (orbActive) {
      orbRafId = requestAnimationFrame(sendOrbFrame);
    }
  }

  function flushOrbThrottle() {
    orbActive = false;
    if (orbRafId) {
      cancelAnimationFrame(orbRafId);
      orbRafId = null;
    }
    if (orbPendingAngle !== null && orbPendingRadius !== null && onInteraction) {
      onInteraction(orbPendingAngle, orbPendingRadius);
    }
    orbPendingAngle = null;
    orbPendingRadius = null;
  }

  // Relative drag (2026-11-20, the user's call): touch-down never jumps the
  // dot. The finger's travel moves it from where it was, one to one with the
  // drawn disc, clamped to the rim; a tap writes nothing.
  const TAP_SLOP = 5; // px
  let downX = 0;
  let downY = 0;
  let startNX = 0; // the dot at touch-down, unit disc, +x right, +y down
  let startNY = 0;
  let unitPx = 1; // pixels per unit of radius, as drawn
  let hasMoved = false;

  function handlePointerDown(event: PointerEvent) {
    event.preventDefault();
    isDragging = true;
    hasMoved = false;
    container.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    // The handle rides 40 viewBox units out at radius 1; the SVG fits its
    // 100-unit box to the shorter side.
    unitPx = (Math.min(rect.width, rect.height) / 100) * 40;
    downX = event.clientX;
    downY = event.clientY;
    const a = localAngle * 2 * Math.PI;
    startNX = localRadius * Math.sin(a);
    startNY = -localRadius * Math.cos(a);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;
    event.preventDefault();
    if (!hasMoved) {
      if (Math.abs(event.clientX - downX) < TAP_SLOP && Math.abs(event.clientY - downY) < TAP_SLOP) return;
      hasMoved = true;
      startOrbThrottle();
    }
    updatePosition(event);
  }

  function handlePointerUp(event: PointerEvent) {
    isDragging = false;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    if (hasMoved) flushOrbThrottle();
    hasMoved = false;
  }

  function updatePosition(event: PointerEvent) {
    let nx = startNX + (event.clientX - downX) / unitPx;
    let ny = startNY + (event.clientY - downY) / unitPx;
    const r = Math.hypot(nx, ny);
    if (r > 1) {
      nx /= r;
      ny /= r;
    }
    localRadius = Math.min(1, r);
    // At the center the angle is undefined: keep the last one.
    if (r > 1e-4) {
      localAngle = ((Math.atan2(nx, -ny) / (2 * Math.PI)) + 1) % 1;
    }

    // Queue for frame-synchronized send
    orbPendingAngle = localAngle;
    orbPendingRadius = localRadius;
  }
</script>

<div class="orb-control">
  <div
    class="orb-container"
    bind:this={container}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    role="slider"
    tabindex="0"
    aria-label="{title}: Angle {(localAngle * 360).toFixed(0)}°, Radius {(localRadius * 100).toFixed(0)}%"
    aria-valuemin={0}
    aria-valuemax={360}
    aria-valuenow={Math.round(localAngle * 360)}
    style="--orb-tint: {color.primary};"
  >
    <svg class="orb-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <!-- Orb disc: tinted fill + thin opaque border -->
      <circle
        cx="50"
        cy="50"
        r="45"
        fill={color.secondary}
        stroke={color.primary}
        stroke-width="1"
        opacity="1"
        class="orb-disc"
      />

      <!-- Handle (sized to match DeviceXY 16px handle) -->
      <circle
        cx={handleX}
        cy={handleY}
        r={isDragging ? 6 : 5}
        fill={color.primary}
        stroke={color.accent}
        stroke-width="1"
        class="orb-handle"
      />

      <!-- Title a third of the way down the disc, clear of the handle at its
           default (angle and radius at half, below center; 2026-10-12). -->
      <text
        x="50"
        y="35"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        opacity="0.7"
        class="orb-title"
      >{title}</text>
    </svg>
  </div>
</div>

<style>
  .orb-control {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    user-select: none;
  }

  .orb-container {
    position: relative;
    width: 100%;
    height: 100%;
    cursor: grab;
    touch-action: none;
  }

  .orb-container:focus {
    outline: none;
  }

  .orb-svg {
    width: 100%;
    height: 100%;
  }

  /* Title is authored mixed-case ("Orb"); Graticule's HUD voice upper-cases
     it here (text-transform applies to SVG <text>), flat shows it as written. */
  .orb-title {
    pointer-events: none;
    user-select: none;
    text-transform: uppercase;
  }

  /* ---- Flat grammar: the orb is a flat ControlBackground disc in a 1px dark
     frame — no tinted wash — with a light-grey grip (ControlFillHandle, same
     as the XY / slider handles) and Live's control text for the title
     (normal case, medium weight, full opacity). The classes out-specify the
     SVG presentation attributes (fill= / stroke=), so no !important. Hybrid
     keeps the family ink on the grip and the title. */
  :global([data-grammar="flat"]) .orb-disc {
    fill: var(--surface-well);
    stroke: var(--line-strong);
  }
  :global([data-grammar="flat"]) .orb-handle {
    fill: var(--flat-handle);
    stroke: var(--line-strong);
  }
  :global([data-grammar="flat"]) .orb-title {
    fill: var(--foreground);
    font-weight: 500;
    text-transform: none;
    opacity: 1;
  }

  :global([data-skin="hybrid"]) .orb-handle {
    fill: var(--orb-tint, var(--flat-handle));
  }
  :global([data-skin="hybrid"]) .orb-title {
    fill: var(--orb-tint, var(--foreground));
  }
  :global(.light[data-skin="hybrid"]) .orb-title {
    fill: color-mix(in oklab, var(--orb-tint, var(--foreground)) 55%, var(--foreground));
  }
</style>
