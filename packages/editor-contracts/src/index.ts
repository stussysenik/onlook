export type FrameworkId = 'svelte' | 'react' | 'vue';

export type EditorNodeKind = 'fragment' | 'element' | 'component' | 'text';

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
}

export interface EditorNode {
  id: string;
  kind: EditorNodeKind;
  name: string;
  attributes: Record<string, string>;
  children: EditorNode[];
  textContent?: string;
  sourceLocation?: SourceLocation;
}

export interface NewEditorNode {
  kind: Exclude<EditorNodeKind, 'fragment'>;
  name: string;
  attributes?: Record<string, string>;
  children?: NewEditorNode[];
  textContent?: string;
}

export interface EditorDocument {
  framework: FrameworkId;
  root: EditorNode;
  source: string;
  editableRange: {
    start: number;
    end: number;
  };
  preservedSource: {
    prefix: string;
    suffix: string;
  };
  warnings: string[];
}

export type EditAction =
  | {
      type: 'update_text';
      nodeId: string;
      text: string;
    }
  | {
      type: 'update_attributes';
      nodeId: string;
      attributes: Record<string, string | null>;
    }
  | {
      type: 'update_styles';
      nodeId: string;
      className: string;
    }
  | {
      type: 'insert_node';
      parentId: string;
      index?: number;
      node: NewEditorNode;
    }
  | {
      type: 'move_node';
      nodeId: string;
      targetParentId: string;
      index: number;
    }
  | {
      type: 'remove_node';
      nodeId: string;
    };
