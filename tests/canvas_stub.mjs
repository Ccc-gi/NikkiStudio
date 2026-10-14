// Placement tests do not need a native Canvas dependency or GPU.
globalThis.document={createElement:()=>({getContext:()=>new Proxy({}, {
  get:(_,name)=>name==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}
})})};
