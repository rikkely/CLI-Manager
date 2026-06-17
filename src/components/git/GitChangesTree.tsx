import { useGitStore } from "../../stores/gitStore";
import { GitTreeNodeComponent } from "./GitTreeNode";

interface GitChangesTreeProps {
  onFileClick: (filePath: string) => void;
  onRequestDiscard: (path: string, name: string, status: string) => void;
}

export function GitChangesTree({ onFileClick, onRequestDiscard }: GitChangesTreeProps) {
  const { tree } = useGitStore();

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <GitTreeNodeComponent key={node.path} node={node} depth={0} onFileClick={onFileClick} onRequestDiscard={onRequestDiscard} />
      ))}
    </div>
  );
}
