/** Net changes only; transient batch steps and draft values never enter this summary. */
export function summarizeChanges(before, after) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const indexed = items => new Map(items.map(item => [item.id, item]));
  function compare(first, second) {
    const a = indexed(first), b = indexed(second);
    return {
      added: [...b.keys()].filter(id => !a.has(id)),
      removed: [...a.keys()].filter(id => !b.has(id)),
      changed: [...b.keys()].filter(id => a.has(id) && !equal(a.get(id), b.get(id))),
    };
  }
  const slides = compare(before.slides, after.slides);
  const elements = compare(before.slides.flatMap(s => s.elements), after.slides.flatMap(s => s.elements));
  const assets = compare(before.assets, after.assets);
  const tokensChanged=!equal(before.styleTokens,after.styleTokens),recipesChanged=!equal(before.styleRecipes,after.styleRecipes);
  const recipeChanges=compare(before.styleRecipes||[],after.styleRecipes||[]),changedRecipes=new Set([...recipeChanges.added,...recipeChanges.removed,...recipeChanges.changed]);
  const affectedStyleSlides=new Set(),affectedStyleElements=new Set();
  if(tokensChanged||recipesChanged)for(const slide of [...before.slides,...after.slides])for(const e of slide.elements)if(e.design&&(tokensChanged||changedRecipes.has(e.design.recipeId))){affectedStyleSlides.add(slide.id);affectedStyleElements.add(e.id);}
  return {
    ...(before.slides.some(s=>s.scene!==undefined)||after.slides.some(s=>s.scene!==undefined)?{sceneChangedSlideIds:after.slides.filter(s=>!equal(before.slides.find(v=>v.id===s.id)?.scene,s.scene)).map(s=>s.id)}:{}),
    ...(before.behavior!==undefined||after.behavior!==undefined?{behaviorVariablesChanged:!equal(before.behavior,after.behavior)}:{}),
    titleChanged: before.title !== after.title,
    canvasChanged: !equal(before.canvas, after.canvas),
    themeChanged: !equal(before.theme, after.theme),
    ...(before.styleTokens!==undefined||after.styleTokens!==undefined?{styleTokensChanged:!equal(before.styleTokens,after.styleTokens)}:{}),
    ...(before.styleRecipes!==undefined||after.styleRecipes!==undefined?{styleRecipesChanged:!equal(before.styleRecipes,after.styleRecipes)}:{}),
    ...(tokensChanged||recipesChanged?{affectedStyleSlideIds:[...affectedStyleSlides],affectedStyleElementIds:[...affectedStyleElements]}:{}),
    ...(before.layouts!==undefined||after.layouts!==undefined?{layoutsChanged:!equal(before.layouts,after.layouts)}:{}),
    ...(before.layoutMasters!==undefined||after.layoutMasters!==undefined?{layoutMastersChanged:!equal(before.layoutMasters,after.layoutMasters)}:{}),
    ...(before.variables !== undefined || after.variables !== undefined ? { variablesChanged: !equal(before.variables, after.variables) } : {}),
    ...(before.master!==undefined||after.master!==undefined?{masterChanged:!equal(before.master,after.master)}:{}),
    ...(before.motionClips!==undefined||after.motionClips!==undefined?{motionClipsChanged:!equal(before.motionClips,after.motionClips)}:{}),
    ...(before.webForms!==undefined||after.webForms!==undefined?{webFormsChanged:!equal(before.webForms,after.webForms)}:{}),
    ...(before.componentLibrary!==undefined||after.componentLibrary!==undefined?{componentLibraryChanged:!equal(before.componentLibrary,after.componentLibrary)}:{}),
    ...(before.responsive!==undefined||after.responsive!==undefined?{responsiveChanged:!equal(before.responsive,after.responsive)}:{}),
    schemaChanged: before.schemaVersion !== after.schemaVersion,
    slideOrderChanged: !equal(before.slides.map(s => s.id), after.slides.map(s => s.id)),
    addedSlideIds: slides.added, removedSlideIds: slides.removed, changedSlideIds: slides.changed,
    addedElementIds: elements.added, removedElementIds: elements.removed, changedElementIds: elements.changed,
    elementOrderChangedSlideIds: after.slides.filter(s => {
      const original = before.slides.find(item => item.id === s.id);
      return original && !equal(original.elements.map(e => e.id), s.elements.map(e => e.id));
    }).map(s => s.id),
    addedAssetIds: assets.added, removedAssetIds: assets.removed, changedAssetIds: assets.changed,
  };
}

export function changedTargetIds(before, after) {
  const summary = summarizeChanges(before, after);
  return [...new Set([
    ...(summary.titleChanged || summary.canvasChanged || summary.themeChanged || summary.behaviorVariablesChanged || summary.styleTokensChanged || summary.styleRecipesChanged || summary.variablesChanged || summary.masterChanged || summary.layoutsChanged || summary.layoutMastersChanged || summary.motionClipsChanged || summary.webFormsChanged || summary.componentLibraryChanged || summary.responsiveChanged || summary.schemaChanged ? [before.id] : []),
    ...summary.addedSlideIds, ...summary.removedSlideIds, ...summary.changedSlideIds,
    ...summary.addedElementIds, ...summary.removedElementIds, ...summary.changedElementIds,
    ...(summary.affectedStyleSlideIds||[]),...(summary.affectedStyleElementIds||[]),
    ...summary.addedAssetIds, ...summary.removedAssetIds, ...summary.changedAssetIds,
  ])];
}
