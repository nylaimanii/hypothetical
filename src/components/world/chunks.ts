// perf: one InstancedMesh per tile type was one huge batch the gpu always drew in full, far side
// included. a ChunkSet splits a type into patches of the cube sphere (each cube face cut 2x2):
//  - each patch has a tight bounding sphere, so three frustum-culls patches off screen
//  - patches past the planet's horizon are hidden outright (the far side never draws, nor casts shadows)
//  - each patch picks a high or low poly tile by its distance to the camera (lod)
// it keeps the InstancedMesh api the planet already uses: setMatrixAt / setColorAt by global index.
import * as THREE from 'three'
import type { Tile } from './lib'

type Chunk = { mesh: THREE.InstancedMesh; ids: number[]; n: THREE.Vector3; r: number }

export class ChunkSet {
  group = new THREE.Group()
  chunks: Chunk[] = []
  private where: Int32Array
  private local: Int32Array
  constructor(
    tileOf: number[], // tile index for every instance, in global instance order
    tiles: Tile[],
    private hi: THREE.BufferGeometry,
    private lo: THREE.BufferGeometry,
    material: THREE.Material,
    opts: { cast?: boolean; receive?: boolean; pick?: boolean; renderOrder?: number } = {},
  ) {
    const n = Math.round(Math.sqrt(tiles.length / 6))
    const half = Math.ceil(n / 2)
    const chunkOf = (ti: number) => {
      const f = Math.floor(ti / (n * n)), rem = ti % (n * n)
      const i = Math.floor(rem / n), j = rem % n
      return f * 4 + (i >= half ? 2 : 0) + (j >= half ? 1 : 0)
    }
    const buckets = new Map<number, number[]>()
    tileOf.forEach((ti, k) => { const c = chunkOf(ti); const b = buckets.get(c); if (b) b.push(k); else buckets.set(c, [k]) })
    this.where = new Int32Array(tileOf.length)
    this.local = new Int32Array(tileOf.length)
    for (const ids of buckets.values()) {
      const mesh = new THREE.InstancedMesh(lo, material, ids.length)
      mesh.castShadow = !!opts.cast
      mesh.receiveShadow = !!opts.receive
      if (opts.renderOrder) mesh.renderOrder = opts.renderOrder
      if (!opts.pick) mesh.raycast = () => {}
      mesh.userData.ids = ids
      const center = new THREE.Vector3()
      for (const k of ids) center.add(tiles[tileOf[k]].normal)
      center.normalize()
      let r = 0
      for (const k of ids) r = Math.max(r, center.angleTo(tiles[tileOf[k]].normal))
      ids.forEach((k, l) => { this.where[k] = this.chunks.length; this.local[k] = l })
      this.chunks.push({ mesh, ids, n: center, r })
      this.group.add(mesh)
    }
  }

  setMatrixAt(k: number, m: THREE.Matrix4) { this.chunks[this.where[k]].mesh.setMatrixAt(this.local[k], m) }
  setColorAt(k: number, c: THREE.Color) { this.chunks[this.where[k]].mesh.setColorAt(this.local[k], c) }
  // the global instance index behind a hit on one of the patches
  globalId(mesh: THREE.Object3D, instanceId: number) { return (mesh.userData.ids as number[] | undefined)?.[instanceId] }

  commitMatrices() { for (const c of this.chunks) { c.mesh.instanceMatrix.needsUpdate = true; c.mesh.computeBoundingSphere() } }
  commitColors() { for (const c of this.chunks) if (c.mesh.instanceColor) c.mesh.instanceColor.needsUpdate = true }

  // per frame: hide what is past the horizon, pick lod by distance
  update(cam: THREE.Vector3, radius: number, hiDist: number) {
    const d = cam.length()
    const horizon = Math.acos(Math.min(1, radius / d))
    const dir = cam.clone().divideScalar(d)
    for (const c of this.chunks) {
      const ang = c.n.angleTo(dir)
      // a little slack so tall stacks and coasts on the rim never pop
      c.mesh.visible = ang - c.r < horizon + 0.12
      if (!c.mesh.visible) continue
      const near = c.n.clone().multiplyScalar(radius).distanceTo(cam) - Math.sin(c.r) * radius < hiDist
      const g = near ? this.hi : this.lo
      if (c.mesh.geometry !== g) c.mesh.geometry = g
    }
  }

  dispose() { for (const c of this.chunks) c.mesh.dispose(); this.group.clear() }
}
