/** Previous dirty comparison retained only as a differential test oracle. */
import{EditorStore,normalizeDocument}from'../../src/model.js';
export class LegacyDirtyStore extends EditorStore{
 loadDocument(input){const d=super.loadDocument(input);this._legacySaved=JSON.stringify(d);return d;}
 get isDirty(){return JSON.stringify(this._draftSnapshot())!==this._legacySaved;}
 markSaved(snapshot,sessionId=this.sessionId){if(sessionId!==this.sessionId)return false;const normalized=normalizeDocument(snapshot);if(normalized.id!==this.document.id)return false;this._legacySaved=JSON.stringify(normalized);return true;}
 markUnsaved(){this._legacySaved='unsaved:test-oracle';return true;}
}
