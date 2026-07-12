import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Scene, PerspectiveCamera, WebGLRenderer, SphereGeometry, MeshBasicMaterial,
  Color, Mesh, Group, InstancedMesh, Matrix4, Vector3,
} from "three";
import { geoEquirectangular, geoPath } from "d3-geo";

// Rotating dotted-land globe with a marker per workforce neuro. Adapted from
// a Framer-marketplace component (Globe — Originkit); adapted, not just
// trimmed:
//   - Land data comes from /land-50m.json served by this app (vendored
//     Natural Earth 50m in web/public) instead of a runtime fetch to
//     raw.githubusercontent.com — the dashboard must not depend on an
//     external CDN being reachable (local-first).
//   - Continent tube-outlines, graticule tube-grid, solid-fill texture mode,
//     drag physics, and hover raycasting are dropped: at dashboard-card size
//     the dotted landmass + markers IS the visual, and the tube geometry
//     paths were the heavy part of the original (hundreds of TubeGeometry
//     builds on every mount). What's kept — equirectangular land rasterize →
//     lat/lng dot lattice with cos(lat) longitude spacing → InstancedMesh —
//     is the original's exact dot pipeline.
//   - Markers pulse (sin-scaled per frame) so the neuros read as alive.
//
// prefers-reduced-motion: globe renders but does not spin (markers still
// mark). WebGL context and geometry are disposed on unmount.

export type GlobeMarker = { lat: number; lng: number; label?: string };

type Props = {
  markers: GlobeMarker[];
  height?: number;
  dotColor?: string;
  markerColor?: string;
  style?: CSSProperties;
};

function latLngToPosition(lat: number, lng: number): { x: number; y: number; z: number } {
  const latRad = lat * (Math.PI / 180);
  const lngRad = lng * (Math.PI / 180);
  return {
    x: Math.cos(latRad) * Math.sin(lngRad),
    y: Math.sin(latRad),
    z: Math.cos(latRad) * Math.cos(lngRad),
  };
}

export function WorkforceGlobe({ markers, height = 240, dotColor = "#5b6b8c", markerColor = "#7d57f6", style }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const markersKey = markers.map(m => `${m.lat},${m.lng}`).join("|");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const w = container.clientWidth || 400;
    const h = container.clientHeight || height;

    const scene = new Scene();
    const camera = new PerspectiveCamera(50, w / h, 0.1, 1000);
    camera.position.set(0, 0, 2.4);
    camera.lookAt(0, 0, 0);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("WebGL unavailable");
      return;
    }
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    const globeGroup = new Group();
    // Start facing southern Africa — where this workforce actually lives.
    globeGroup.rotation.y = (-31 * Math.PI) / 180;
    globeGroup.rotation.x = (-15 * Math.PI) / 180;
    scene.add(globeGroup);

    // Near-invisible ocean sphere gives the dots a depth-tested backdrop so
    // the far side of the lattice doesn't show through the front.
    const ocean = new Mesh(
      new SphereGeometry(0.985, 48, 48),
      new MeshBasicMaterial({ color: new Color("#0a0f1c"), transparent: true, opacity: 0.9 }),
    );
    globeGroup.add(ocean);

    let disposed = false;
    let raf = 0;
    const markerMeshes: Mesh[] = [];
    const disposables: { dispose(): void }[] = [ocean.geometry, ocean.material as MeshBasicMaterial];

    (async () => {
      try {
        const resp = await fetch("/land-50m.json");
        if (!resp.ok) throw new Error(`land data ${resp.status}`);
        const land = await resp.json();
        if (disposed) return;

        // Rasterize land to an offscreen equirectangular bitmap, then lay a
        // lat/lng dot lattice and keep the dots that land on land.
        const bw = 1024, bh = 512;
        const off = document.createElement("canvas");
        off.width = bw; off.height = bh;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("canvas 2d unavailable");
        const projection = geoEquirectangular().fitSize([bw, bh], { type: "Sphere" } as any);
        const path = geoPath().projection(projection).context(ctx);
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, bw, bh);
        ctx.fillStyle = "#fff"; ctx.beginPath();
        for (const f of land.features) path(f);
        ctx.fill();
        const pixels = ctx.getImageData(0, 0, bw, bh).data;
        const isOnLand = (lng: number, lat: number) => {
          const x = Math.round(((lng + 180) / 360) * bw) % bw;
          const y = Math.max(0, Math.min(bh - 1, Math.round(((90 - lat) / 180) * bh)));
          return pixels[(y * bw + x) * 4] > 128;
        };

        const coords: number[][] = [];
        const step = 1.6;
        for (let lat = -90; lat <= 90; lat += step) {
          const cosLat = Math.cos((Math.abs(lat) * Math.PI) / 180);
          const lngStep = cosLat > 0.01 ? step / Math.max(0.3, cosLat) : 360;
          for (let lng = -180; lng < 180; lng += lngStep) {
            if (isOnLand(lng, lat)) coords.push([lng, lat]);
          }
        }

        const dotGeo = new SphereGeometry(0.0045, 4, 4);
        const dotMat = new MeshBasicMaterial({ color: new Color(dotColor) });
        const instanced = new InstancedMesh(dotGeo, dotMat, coords.length);
        const m4 = new Matrix4();
        coords.forEach(([lng, lat], i) => {
          const p = latLngToPosition(lat, lng);
          m4.makeScale(1, 1, 1);
          m4.setPosition(p.x, p.y, p.z);
          instanced.setMatrixAt(i, m4);
        });
        instanced.instanceMatrix.needsUpdate = true;
        globeGroup.add(instanced);
        disposables.push(dotGeo, dotMat);

        const markerGeo = new SphereGeometry(0.022, 12, 12);
        const markerMat = new MeshBasicMaterial({ color: new Color(markerColor) });
        disposables.push(markerGeo, markerMat);
        for (const mk of markers) {
          const p = latLngToPosition(mk.lat, mk.lng);
          const mesh = new Mesh(markerGeo, markerMat);
          mesh.position.set(p.x * 1.005, p.y * 1.005, p.z * 1.005);
          globeGroup.add(mesh);
          markerMeshes.push(mesh);
        }

        renderer.render(scene, camera);

        const spin = reducedMotion ? 0 : 0.0028;
        const tick = (now: number) => {
          if (disposed) return;
          globeGroup.rotation.y += spin;
          const pulse = 1 + Math.sin(now / 400) * 0.35;
          for (const mesh of markerMeshes) mesh.scale.setScalar(pulse);
          renderer.render(scene, camera);
          if (spin !== 0 || markerMeshes.length > 0) raf = requestAnimationFrame(tick);
        };
        if (!reducedMotion) raf = requestAnimationFrame(tick);
      } catch (e: any) {
        if (!disposed) setError(e?.message ?? "failed to load globe");
      }
    })();

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth || 400;
      const nh = container.clientHeight || height;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      renderer.render(scene, camera);
    });
    ro.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const d of disposables) { try { d.dispose(); } catch { /* tolerate */ } }
      renderer.dispose();
      try { container.removeChild(canvas); } catch { /* already gone */ }
    };
  }, [markersKey, dotColor, markerColor, height]);

  if (error) {
    return <div style={{ height, ...style }} className="grid place-items-center text-xs text-cream-300/40">globe unavailable — {error}</div>;
  }
  return <div ref={containerRef} aria-hidden style={{ position: "relative", height, ...style }} />;
}
