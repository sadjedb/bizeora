/**
 * Where the demo garment model lives.
 *
 * Constants only, in their own module, because both the generator and the seed
 * need them and `scripts/make-demo-model.ts` writes a file the moment it is
 * imported. An import with a side effect is a surprise waiting for whoever adds
 * the second caller.
 *
 * The object id is **fixed**, unlike every other storage key in this
 * application. Keys are generated UUIDs precisely so they cannot be guessed;
 * this one is committed demo content, the seed has to point at it twice, and
 * regenerating it must not orphan the previous file. It is UUID-shaped so
 * `isValidStorageKey` accepts it.
 */

export const DEMO_MODEL_ID = '00000000-0000-4000-8000-00000000d3d0';

export const DEMO_MODEL_KEY = `models/${DEMO_MODEL_ID}.glb`;

/** The material the design is composited into. "Rib" is the collar. */
export const DEMO_MODEL_MATERIAL = 'Fabric';

/** The product the seed attaches it to. */
export const DEMO_MODEL_PRODUCT_SLUG = 't-shirt-brode-classique';
