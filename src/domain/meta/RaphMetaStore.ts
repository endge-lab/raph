import type { DataPath } from '@/domain/entities/DataPath'

import { SegKind } from '@/domain/types/path.types'

interface MetaNode {
  children: Map<string, MetaNode>
  namespaces: Map<string, unknown>
  path: DataPath | null
}

function createNode(): MetaNode {
  return { children: new Map(), namespaces: new Map(), path: null }
}

/** Kernel-owned tree пользовательской metadata, адресованной каноническим DataPath. */
export class RaphMetaStore {
  private readonly _root = createNode()
  public size = 0

  public get(path: DataPath, namespace?: string): unknown {
    const node = this._find(path)
    if (!node) {
      return undefined
    }
    return namespace === undefined ? Object.fromEntries(node.namespaces) : node.namespaces.get(namespace)
  }

  public has(path: DataPath, namespace?: string): boolean {
    const node = this._find(path)
    if (!node) {
      return false
    }
    return namespace === undefined ? node.namespaces.size > 0 : node.namespaces.has(namespace)
  }

  public set(path: DataPath, namespace: string, value: unknown): void {
    const node = this._ensure(path)
    if (!node.namespaces.has(namespace)) {
      this.size++
    }
    node.namespaces.set(namespace, value)
    node.path = path
  }

  public merge(path: DataPath, namespace: string, value: unknown): void {
    const current = this.get(path, namespace)
    if (isPlainObject(current) && isPlainObject(value)) {
      Object.assign(current, value)
      return
    }
    this.set(path, namespace, value)
  }

  public delete(path: DataPath, namespace?: string): DataPath[] {
    const stack = this._findStack(path)
    const node = stack.at(-1)?.node
    if (!node) {
      return []
    }
    if (namespace === undefined) {
      if (!node.namespaces.size) {
        return []
      }
      this.size -= node.namespaces.size
      node.namespaces.clear()
    }
    else {
      if (!node.namespaces.delete(namespace)) {
        return []
      }
      this.size--
    }
    this._pruneEmpty(stack)
    return [path]
  }

  public deleteSubtree(path: DataPath): DataPath[] {
    const keys = segmentKeys(path)
    if (keys.length === 0) {
      return this.clear()
    }
    let parent = this._root
    for (let index = 0; index < keys.length - 1; index++) {
      const child = parent.children.get(keys[index]!)
      if (!child) {
        return []
      }
      parent = child
    }
    const lastKey = keys.at(-1)!
    const removed = parent.children.get(lastKey)
    if (!removed) {
      return []
    }
    const paths = collectPaths(removed)
    this.size -= countNamespaces(removed)
    parent.children.delete(lastKey)
    return paths
  }

  public pruneMissing(path: DataPath, ownerExists: (path: DataPath) => boolean): DataPath[] {
    const node = this._find(path)
    if (!node) {
      return []
    }
    const removed: DataPath[] = []
    this._pruneMissingNode(node, ownerExists, removed)
    return removed
  }

  public pruneMissingSiblings(path: DataPath, ownerExists: (path: DataPath) => boolean): DataPath[] {
    const keys = segmentKeys(path)
    const stack: Array<{ key: string | null, node: MetaNode }> = [{ key: null, node: this._root }]
    let current = this._root
    for (const key of keys.slice(0, -1)) {
      const child = current.children.get(key)
      if (!child) {
        return []
      }
      stack.push({ key, node: child })
      current = child
    }
    const removed: DataPath[] = []
    this._pruneMissingNode(current, ownerExists, removed)
    this._pruneEmpty(stack)
    return removed
  }

  public clear(): DataPath[] {
    const paths = collectPaths(this._root)
    this._root.children.clear()
    this._root.namespaces.clear()
    this._root.path = null
    this.size = 0
    return paths
  }

  private _find(path: DataPath): MetaNode | null {
    let current = this._root
    for (const key of segmentKeys(path)) {
      const child = current.children.get(key)
      if (!child) {
        return null
      }
      current = child
    }
    return current
  }

  private _ensure(path: DataPath): MetaNode {
    let current = this._root
    for (const key of segmentKeys(path)) {
      let child = current.children.get(key)
      if (!child) {
        child = createNode()
        current.children.set(key, child)
      }
      current = child
    }
    return current
  }

  private _findStack(path: DataPath): Array<{ key: string | null, node: MetaNode }> {
    const stack: Array<{ key: string | null, node: MetaNode }> = [{ key: null, node: this._root }]
    let current = this._root
    for (const key of segmentKeys(path)) {
      const child = current.children.get(key)
      if (!child) {
        return []
      }
      stack.push({ key, node: child })
      current = child
    }
    return stack
  }

  private _pruneEmpty(stack: Array<{ key: string | null, node: MetaNode }>): void {
    for (let index = stack.length - 1; index > 0; index--) {
      const current = stack[index]!
      if (current.node.namespaces.size || current.node.children.size) {
        return
      }
      stack[index - 1]!.node.children.delete(current.key!)
    }
  }

  private _pruneMissingNode(node: MetaNode, ownerExists: (path: DataPath) => boolean, removed: DataPath[]): boolean {
    for (const [key, child] of [...node.children]) {
      if (this._pruneMissingNode(child, ownerExists, removed)) {
        node.children.delete(key)
      }
    }
    if (node.path && node.namespaces.size && !ownerExists(node.path)) {
      this.size -= node.namespaces.size
      node.namespaces.clear()
      removed.push(node.path)
    }
    return node !== this._root && node.namespaces.size === 0 && node.children.size === 0
  }
}

function segmentKeys(path: DataPath): string[] {
  return path.segments().map((segment) => {
    switch (segment.kind) {
      case SegKind.Key:
        return `k:${String(segment.key)}`
      case SegKind.Index:
        return `i:${String(segment.index)}`
      case SegKind.Param:
        return `p:${String(segment.pkey)}=${JSON.stringify(segment.pval)}`
      case SegKind.Wildcard:
        return `w:${(segment as typeof segment & { asIndex?: boolean }).asIndex ? 'index' : 'key'}`
      default:
        throw new Error('[RaphMetaStore] Unsupported DataPath segment.')
    }
  })
}

function collectPaths(node: MetaNode): DataPath[] {
  const result = node.path && node.namespaces.size ? [node.path] : []
  for (const child of node.children.values()) {
    result.push(...collectPaths(child))
  }
  return result
}

function countNamespaces(node: MetaNode): number {
  let count = node.namespaces.size
  for (const child of node.children.values()) {
    count += countNamespaces(child)
  }
  return count
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
