import Link from 'next/link'
import type { TreeNode } from '@/lib/build-tree'
import { typeLabel } from '@/lib/constants'

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const label = typeLabel(node.object_type)
  return (
    <>
      <li>
        <Link
          href={`/objects/${node.id}`}
          className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity gap-2"
          style={{ paddingLeft: depth * 20 + 16 + 'px' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {depth > 0 && <span className="text-bark shrink-0">└</span>}
            <span className="font-mono text-sm font-medium">{node.workshop_id}</span>
            <span className="text-xs text-bark">{label}</span>
          </div>
          {node.status && (
            <span className="text-xs text-bark capitalize shrink-0">
              {node.status.replace(/_/g, ' ')}
            </span>
          )}
        </Link>
      </li>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

export function ObjectTree({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul className="divide-y divide-hairline">
      {nodes.map((node) => (
        <TreeRow key={node.id} node={node} depth={0} />
      ))}
    </ul>
  )
}
