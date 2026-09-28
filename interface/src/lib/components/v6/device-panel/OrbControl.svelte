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

  function handlePointerDown(event: PointerEvent) {
    isDragging = true;
    container.setPointerCapture(event.pointerId);
    startOrbThrottle();
    updatePosition(event);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;
    updatePosition(event);
  }

  function handlePointerUp(event: PointerEvent) {
    isDragging = false;
    container.releasePointerCapture(event.pointerId);
    flushOrbThrottle();
  }

  function updatePosition(event: PointerEvent) {
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Calculate relative position from center
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;

    // Calculate angle (0° at top, clockwise)
    let angleRad = Math.atan2(dy, dx);
    let angleDeg = (angleRad * 180 / Math.PI + 90 + 360) % 360; // Convert to 0-360 with 0° at top
    localAngle = angleDeg / 360; // Normalize to 0-1

    // Calculate radius (distance from center, normalized to container)
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = Math.min(rect.width, rect.height) / 2;
    localRadius = Math.max(0, Math.min(1, distance / maxDistance));

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
    role="slider"
    tabindex="0"
    aria-label="{title}: Angle {(localAngle * 360).toFixed(0)}°, Radius {(localRadius * 100).toFixed(0)}%"
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

      <!-- Title in center -->
      <text
        x="50"
        y="50"
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
    cursor: crosshair;
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
