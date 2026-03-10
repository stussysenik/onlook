export type FrameworkId = 'svelte' | 'react' | 'vue';
export type ProviderId = 'nvidia_nim';
export type ModelMode = 'instant' | 'thinking';

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

export interface CopilotProviderOptions {
  provider: ProviderId;
  model: string;
  mode: ModelMode;
}

export interface CopilotEditRequest {
  framework: FrameworkId;
  intent: string;
  selected_node_id: string | null;
  project_id?: string;
  session_id?: string;
  document: EditorDocument;
  provider_options?: Partial<CopilotProviderOptions>;
}

export interface CopilotEditResponse {
  provider: ProviderId;
  model: string;
  mode: ModelMode;
  message: string;
  edits: EditAction[];
  warnings: string[];
}

export interface ElementSourceHandle {
  file: string;
  line: number;
  column: number;
}

export interface BridgeElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BridgeElementSnapshot {
  id: string;
  tag: string;
  text: string;
  className: string;
  rect: BridgeElementRect;
  source: ElementSourceHandle;
  canEditText: boolean;
}

export interface BridgeSnapshotMessage {
  type: 'onlook:snapshot';
  url: string;
  elements: BridgeElementSnapshot[];
}

export interface BridgeRequestSnapshotMessage {
  type: 'onlook:request-snapshot';
}

export type OnlookBridgeMessage = BridgeSnapshotMessage | BridgeRequestSnapshotMessage;

export type ApplyDomEditRequest =
  | {
      source: ElementSourceHandle;
      action: {
        type: 'update_text';
        text: string;
      };
    }
  | {
      source: ElementSourceHandle;
      action: {
        type: 'update_class';
        className: string;
      };
    };

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
