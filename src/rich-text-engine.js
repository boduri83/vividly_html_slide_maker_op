// Reused text engine; its local history belongs only to the active human draft.
export { Editor, Extension } from '@tiptap/core';
export { default as StarterKit } from '@tiptap/starter-kit';
export { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style';
export { closeHistory } from '@tiptap/pm/history';
export { Slice } from '@tiptap/pm/model';
