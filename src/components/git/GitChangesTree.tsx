import type { GitTreeNode, Project } from "../../lib/types";
import { GitTreeNodeComponent } from "./GitTreeNode";

interface GitChangesTreeProps {
  project: Pick<Project, "name"> | null;
  nodes: GitTreeNode[];
  treeId: string;
  onFileClick: (filePath: string) => void;
  onRequestDiscard: (path: string, name: string, status: string) => void;
  onToggleStage: (filePath: string, staged: boolean) => void;
  onToggleStagePaths: (paths: string[], allStaged: boolean) => void;
}

export function GitChangesTree({ project, nodes, treeId, onFileClick, onRequestDiscard, onToggleStage, onToggleStagePaths }: GitChangesTreeProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <GitTreeNodeComponent
          key={node.path}
          project={project}
          node={node}
          depth={0}
          treeId={treeId}
          onFileClick={onFileClick}
          onRequestDiscard={onRequestDiscard}
          onToggleStage={onToggleStage}
          onToggleStagePaths={onToggleStagePaths}
        />
      ))}
    </div>
  );
}
