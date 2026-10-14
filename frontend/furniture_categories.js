export function categoryRoot(id,categories){let key=String(id??'0'),seen=new Set();while(categories[key]?.parentId&&!seen.has(key)){seen.add(key);key=String(categories[key].parentId);}return categories[key]?key:'0';}
export function categoryLabel(id,categories){const key=String(id??'0'),root=categoryRoot(key,categories);return root===key?(categories[key]?.name?.replaceAll('家具','物品')??'未分类'):(categories[root]?.name?.replaceAll('家具','物品')+' / '+categories[key]?.name?.replaceAll('家具','物品'));}
export function matchesCategory(id,major,minor,categories){const key=String(id??'0');return (!major||categoryRoot(key,categories)===major)&&(!minor||key===minor);}
export function populateCategories(major,minor,source,catalog,categories){
  const counts=new Map(),roots=new Map();for(const item of source){const key=String(catalog[item.id]?.categoryId??'0'),root=categoryRoot(key,categories);counts.set(key,(counts.get(key)??0)+1);roots.set(root,(roots.get(root)??0)+1);}
  const majorValue=major.value,minorValue=minor.value;
  major.replaceChildren(new Option('全部大类',''));for(const [id,category] of Object.entries(categories)){if(category.parentId)continue;major.add(new Option(`${category.name.replaceAll('家具','物品')} (${roots.get(id)??0})`,id));}major.value=majorValue;
  minor.replaceChildren(new Option('全部子类',''));for(const [id,category] of Object.entries(categories)){if(!category.parentId||(major.value&&categoryRoot(id,categories)!==major.value))continue;minor.add(new Option(`${major.value?category.name.replaceAll('家具','物品'):categoryLabel(id,categories)} (${counts.get(id)??0})`,id));}minor.value=[...minor.options].some(o=>o.value===minorValue)?minorValue:'';
}
