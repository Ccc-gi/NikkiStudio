import * as T from 'three';

// Original procedural scenery: no downloaded artwork or game-resource dependency.
export function createStorybookSky(){
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  let seed=3871;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const gradient=c.createLinearGradient(0,0,0,h);
  gradient.addColorStop(0,'#5d9bd4');gradient.addColorStop(.3,'#99cbe9');
  gradient.addColorStop(.48,'#d9eaf0');gradient.addColorStop(.53,'#c4d5b7');
  gradient.addColorStop(.7,'#91aa78');gradient.addColorStop(1,'#829965');
  c.fillStyle=gradient;c.fillRect(0,0,w,h);
  // Puffy clouds wrap across the panorama seam; strokes remain soft under PMREM.
  for(let i=0;i<30;i++){
    const x=random()*w,y=h*(.12+random()*.31),size=25+random()*65;
    const puffs=Array.from({length:7},()=>[size*(.35+random()*.22),size*(.16+random()*.13)]);
    for(const wrap of [-w,0,w]){
      c.save();c.translate(x+wrap,y);c.scale(1,1.8);
      c.shadowColor='rgba(255,248,226,.4)';c.shadowBlur=15;
      for(let j=0;j<7;j++){
        c.fillStyle=j<2?'rgba(207,221,236,.65)':'rgba(255,251,236,.84)';
        c.beginPath();c.ellipse((j-3)*size*.35,Math.sin(j*1.7)*size*.12,
          ...puffs[j],0,0,Math.PI*2);c.fill();
      }
      c.restore();
    }
  }
  // Distant painted hills: periodic functions keep the 360-degree seam continuous.
  for(const [base,amplitude,color,phase] of [[.505,.045,'#a6bfd0',.7],[.535,.036,'#a1bbae',2],[.56,.025,'#92ae8e',4]]){
    c.fillStyle=color;c.beginPath();c.moveTo(0,h);
    for(let x=0;x<=w;x+=4){const t=x/w*Math.PI*2;
      const y=h*(base-amplitude*(.5+.3*Math.sin(t*5+phase)+.2*Math.sin(t*9-phase)));
      c.lineTo(x,y);
    }
    c.lineTo(w,h);c.closePath();c.fill();
  }
  const texture=new T.CanvasTexture(canvas);texture.mapping=T.EquirectangularReflectionMapping;
  texture.colorSpace=T.SRGBColorSpace;return texture;
}

export function createMeadowTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const c=canvas.getContext('2d');c.fillStyle='#8c9e64';c.fillRect(0,0,256,256);
  let seed=918;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<14000;i++){
    const shade=80+Math.floor(random()*40);c.fillStyle=`rgba(${shade+26},${shade+43},${shade-6},.16)`;
    c.fillRect(random()*256,random()*256,1+random()*3,1+random()*4);
  }
  const texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;return texture;
}
