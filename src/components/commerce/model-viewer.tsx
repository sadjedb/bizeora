'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Text } from '@/components/ui/typography';
import { cn } from '@/components/ui/cn';
import { texturePlacement, textureSizeFor } from '@/domain/model3d/texture';
import { useDictionary } from '@/i18n/client';
import type { DesignTransform } from '@/domain/customization/placement';
/*
 * Types only, so this import is erased at build time and `three` still arrives
 * in its own chunk when somebody opens a 3D view. The runtime import is inside
 * the effect.
 */
import type { MeshStandardMaterial, Object3D } from 'three';
import type * as ThreeModule from 'three';

/**
 * The garment, in three dimensions, with the customer's design on it.
 *
 * This is the other half of the promise ADR-035 made when it chose to store a
 * placement as four percentages in texture space: **the same transform that
 * positions the design over a photograph positions it inside the model's UV
 * map**. Nothing here re-interprets the placement; it hands the numbers to
 * `texturePlacement` and draws.
 *
 * ## Everything is loaded on demand
 *
 * `three` is the largest dependency in the project by some margin, and the vast
 * majority of visitors never open a 3D view. It is therefore imported inside
 * the effect, not at the top of the module, so it lands in its own chunk that
 * is fetched the first time somebody asks for it. A product page that nobody
 * rotates pays nothing.
 *
 * ## The failure states are the interesting ones
 *
 * A 3D viewer has more ways to not work than most components: no WebGL, a model
 * that 404s, a file that loads but has no material by that name, a phone that
 * runs out of memory. Each of those is caught and reported in words, because
 * the alternative — a black rectangle — is indistinguishable from a broken
 * site. The poster image stays underneath throughout, so the worst case is the
 * picture the visitor would have seen anyway.
 */

export type ModelViewerDesign = {
  /** The artwork, as a URL the canvas may read. Same origin. */
  src: string;
  transform: DesignTransform;
};

export type ModelViewerProps = {
  src: string;
  materialName: string;
  /** Shown before the model loads, and left in place if it never does. */
  poster?: string | null;
  design?: ModelViewerDesign | null;
  className?: string;
};

type Status = 'loading' | 'ready' | 'failed';

export function ModelViewer({
  src,
  materialName,
  poster,
  design,
  className,
}: ModelViewerProps) {
  const { t } = useDictionary();
  const host = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * One effect for the whole lifetime of the scene.
   *
   * Splitting it — load here, texture there — reads better and is wrong: a
   * WebGL context is a scarce resource (browsers cap them at around sixteen),
   * so the renderer has to be created and disposed in the same place, and
   * every path out of here has to reach the teardown. `cancelled` is what makes
   * an unmount during the load not leave a renderer behind.
   */
  useEffect(() => {
    const container = host.current;
    if (!container) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;

    void (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { OrbitControls } =
          await import('three/examples/jsm/controls/OrbitControls.js');

        if (cancelled) return;

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          // The garment is the subject; a high pixel ratio on a phone buys
          // very little and costs frames.
          powerPreference: 'default',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          35,
          container.clientWidth / Math.max(container.clientHeight, 1),
          0.1,
          100,
        );

        /*
         * Studio lighting, not a sun.
         *
         * A garment is a matte surface photographed in a workshop, and a single
         * directional light makes it read as plastic. A hemisphere fill plus a
         * key and a rim is the cheapest arrangement that looks like cloth.
         */
        scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));

        const key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(2, 3, 4);
        scene.add(key);

        const rim = new THREE.DirectionalLight(0xffffff, 0.8);
        rim.position.set(-3, 1, -2);
        scene.add(rim);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        // Turning, not flying: panning and zooming out to infinity are ways to
        // lose the garment, and getting back is not obvious. The distance
        // limits are set once the model's size is known.
        controls.enablePan = false;

        const gltf = await new GLTFLoader().loadAsync(src);
        if (cancelled) {
          renderer.dispose();
          return;
        }

        const model = gltf.scene;
        scene.add(model);

        /*
         * Frame it, whatever size it was modelled at.
         *
         * A `.glb` from outside the business can be a metre tall or a hundred;
         * the camera is placed from the model's own bounding sphere so the
         * garment fills the frame either way. This is also why the controls'
         * distance limits are set relative to it.
         */
        const box = new THREE.Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const scale = sphere.radius > 0 ? 1 / sphere.radius : 1;

        model.scale.setScalar(scale);
        model.position.sub(sphere.center.multiplyScalar(scale));

        /*
         * Far enough back that the whole garment fits, computed rather than
         * guessed.
         *
         * The model is normalised to a unit bounding sphere above, so the
         * distance at which a sphere of radius 1 exactly fills the frame is
         * `1 / sin(fov / 2)` — vertically. A portrait garment in a landscape
         * viewport is cut off at that distance, so the horizontal field is
         * checked too and the larger of the two wins, with a small margin so
         * the silhouette never touches the edge.
         */
        const vertical = (camera.fov * Math.PI) / 180;
        const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
        const fit = 1 / Math.sin(Math.min(vertical, horizontal) / 2);
        const distance = fit * 1.12;

        camera.position.set(0, 0.1, distance);
        controls.target.set(0, 0, 0);
        controls.minDistance = distance * 0.55;
        controls.maxDistance = distance * 1.8;
        controls.update();

        // --- the design, composited into the named material ----------------
        const disposables: { dispose: () => void }[] = [];

        if (design) {
          const painted = await paintDesign({
            THREE,
            model,
            materialName,
            design,
          });

          if (painted === 'NO_MATERIAL') {
            if (!cancelled) {
              setFailure(t.model.missingMaterial(materialName));
              setStatus('failed');
            }

            renderer.dispose();
            container.replaceChildren();
            return;
          }

          if (painted) disposables.push(painted);
        }

        if (cancelled) {
          renderer.dispose();
          return;
        }

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        controls.autoRotate = !reduced;
        controls.autoRotateSpeed = 0.9;

        // Stop turning by itself the moment somebody takes hold of it: an
        // object that keeps moving under the finger is an object nobody can aim.
        controls.addEventListener('start', () => {
          controls.autoRotate = false;
        });

        let frame = 0;
        const tick = () => {
          frame = requestAnimationFrame(tick);
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        const resize = new ResizeObserver(() => {
          const width = container.clientWidth;
          const height = Math.max(container.clientHeight, 1);

          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        });

        resize.observe(container);

        setStatus('ready');

        teardown = () => {
          cancelAnimationFrame(frame);
          resize.disconnect();
          controls.dispose();

          // Geometries, materials and textures are GPU allocations and are not
          // collected with the objects that referenced them.
          model.traverse((node) => {
            const mesh = node as { geometry?: { dispose(): void }; material?: unknown };
            mesh.geometry?.dispose();

            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : mesh.material
                ? [mesh.material]
                : [];

            for (const material of materials) {
              (material as { dispose?: () => void }).dispose?.();
            }
          });

          for (const item of disposables) item.dispose();

          renderer.dispose();
          container.replaceChildren();
        };
      } catch {
        if (cancelled) return;

        // Deliberately one message for every cause. "WebGL context creation
        // failed" is not a sentence a customer can act on, and the action is
        // the same whatever went wrong: look at the photograph instead.
        setFailure(t.model.failed);
        setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
    // `t.model` whole rather than its two strings: the dictionary object is
    // stable for a language, and listing leaves makes the list wrong the day a
    // third message is used in here.
  }, [src, materialName, design, t.model]);

  return (
    <div
      className={cn(
        'bg-bg-subtle relative aspect-square w-full overflow-hidden rounded-md',
        className,
      )}
    >
      {/*
       * The poster sits underneath the canvas rather than being swapped out.
       * It is what the visitor sees while the model downloads, and what they
       * keep seeing if it never does.
       */}
      {/*
       * A plain `<img>`, not `next/image`. The poster is the background of a
       * canvas rather than content: it has to fill this box exactly, and the
       * optimiser's wrapper would put a second layout box around it.
       */}
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          className={cn(
            'absolute inset-0 size-full object-contain transition-opacity duration-500',
            status === 'ready' ? 'opacity-0' : 'opacity-100',
          )}
        />
      )}

      <div
        ref={host}
        className="absolute inset-0 size-full touch-none"
        // The canvas is the control. Without a name and a role it is an
        // unlabelled graphic to a screen reader, and the instruction to drag it
        // is the only way anybody knows it turns.
        role="img"
        aria-label={t.model.label}
      />

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Text variant="body-sm" tone="subtle">
            {t.model.loading}
          </Text>
        </div>
      )}

      {status === 'failed' && (
        <div className="bg-bg/80 absolute inset-0 flex items-center justify-center p-6 text-center">
          <Text variant="body-sm" tone="muted">
            {failure ?? t.model.failed}
          </Text>
        </div>
      )}

      {status === 'ready' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
          <span className="bg-bg/80 text-fg-muted text-caption inline-flex items-center gap-1.5 rounded-full px-3 py-1.5">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t.model.hint}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Draw the artwork into the named material's texture.
 *
 * The composite happens on a 2D canvas rather than in a shader, and that is a
 * deliberate trade. A shader would let the design be moved without re-uploading
 * a texture; a canvas is forty lines, runs anywhere WebGL runs, and produces
 * exactly the same pixels as the 2D preview the customer just dragged — which
 * is the property that matters, because the two views must agree.
 *
 * Returns `'NO_MATERIAL'` when the model has no material by that name. That is
 * a **configuration** error — the workshop named a material the file does not
 * declare — and it is reported rather than ignored, because the alternative is
 * a garment that silently renders blank.
 */
async function paintDesign(input: {
  THREE: typeof ThreeModule;
  model: Object3D;
  materialName: string;
  design: ModelViewerDesign;
}): Promise<{ dispose: () => void } | null | 'NO_MATERIAL'> {
  const { THREE, model, materialName, design } = input;

  const targets: MeshStandardMaterial[] = [];

  model.traverse((node) => {
    const mesh = node as { material?: unknown };
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    for (const candidate of materials) {
      const material = candidate as MeshStandardMaterial;
      if (material?.name === materialName) targets.push(material);
    }
  });

  if (targets.length === 0) return 'NO_MATERIAL';

  const artwork = await loadImage(design.src);

  const size = textureSizeFor({
    artworkWidth: artwork.naturalWidth || 1024,
    transform: design.transform,
  });

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return null;

  /*
   * The garment's own colour underneath, not white.
   *
   * The material's `map` is the fabric's texture when it has one; when it does
   * not, its `color` is the colour the garment is. Painting onto white would
   * turn every black hoodie white the moment a design was placed on it.
   */
  const base = targets[0];
  const existing = base?.map?.image as CanvasImageSource | undefined;

  if (existing) {
    context.drawImage(existing, 0, 0, size, size);
  } else {
    context.fillStyle = `#${(base?.color?.getHexString() ?? 'ffffff') as string}`;
    context.fillRect(0, 0, size, size);
  }

  const placed = texturePlacement({
    transform: design.transform,
    textureSize: size,
    aspect: artwork.naturalHeight / Math.max(artwork.naturalWidth, 1),
  });

  context.save();
  context.translate(placed.centreX, placed.centreY);
  context.rotate(placed.rotation);
  context.drawImage(
    artwork,
    -placed.width / 2,
    -placed.height / 2,
    placed.width,
    placed.height,
  );
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // glTF UVs have their origin at the top left.
  texture.needsUpdate = true;

  for (const material of targets) {
    material.map = texture;
    // The colour multiplies the map, so a tinted material would tint the
    // artwork too. The colour is already painted into the canvas above.
    material.color?.set(0xffffff);
    material.needsUpdate = true;
  }

  return { dispose: () => texture.dispose() };
}

/** An `<img>` that resolves when it is usable, and rejects rather than hanging. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    // Same origin in this application, but a canvas that reads a tainted image
    // throws on `toDataURL` and on being uploaded as a texture in some
    // browsers. Asking for CORS costs nothing and removes the class.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}
