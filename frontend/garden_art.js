import * as T from 'three';
import {growthRandom,ATLAS_COLUMNS} from './garden_growth.js';

// Original Canvas artwork; generated once, shared by grass and wildflowers.
export function createGardenAtlas(){
  const canvas=document.createElement('canvas');canvas.width=256*ATLAS_COLUMNS;canvas.height=256;
  const c=canvas.getContext('2d');
  for(let variant=0;variant<4;variant++){
    c.save();c.translate(variant*256,0);
    const leaves=[22,20,15,13][variant];
    for(let leaf=0;leaf<leaves;leaf++){
      const r=salt=>growthRandom(variant+113,leaf,salt);
      const rootX=128+(r(1)-.5)*[48,30,22,42][variant],rootY=247-r(2)*4;
      const tipX=128+(r(3)-.5)*[200,140,180,202][variant];
      const tipY=[65,26,14,47][variant]+r(4)*[83,85,68,96][variant];
      const width=[4,2.5,2,3.5][variant]+r(5)*[5,3.5,2.5,4][variant];
      const sway=(tipX-rootX)*(.35+r(6)*.35),droop=variant===2?18+r(7)*22:r(7)*12;
      const gradient=c.createLinearGradient(rootX,rootY,tipX,tipY);
      gradient.addColorStop(0,'#638342');gradient.addColorStop(.35,'#79a24d');
      gradient.addColorStop(.8,r(8)<.25?'#a7c56b':'#90b45b');gradient.addColorStop(1,'#b0c978');
      c.fillStyle=gradient;c.beginPath();c.moveTo(rootX-width*.35,rootY);
      c.bezierCurveTo(rootX+sway-width,rootY-55,tipX-sway-width,tipY+droop,tipX,tipY);
      c.bezierCurveTo(tipX-sway+width,tipY+droop+32,rootX+sway+width,rootY-47,rootX+width*.35,rootY);
      c.closePath();c.fill();
    }
    c.restore();
  }
  for(let variant=4;variant<=6;variant++){
    c.save();c.translate(variant*256,0);
    for(let stem=0;stem<2;stem++){
      const x=stem===0?118:174,y=stem===0?48:105,rootX=122+stem*12;
      c.strokeStyle='#698b46';c.lineWidth=3;c.beginPath();c.moveTo(rootX,246);
      c.bezierCurveTo(rootX-16,190,x+12,125,x,y);c.stroke();
      for(let leaf=0;leaf<3;leaf++){
        const ly=210-leaf*29,lx=rootX+(x-rootX)*leaf*.2,sign=(leaf+stem)%2?-1:1;
        c.fillStyle=leaf%2?'#94af61':'#7d9d51';c.beginPath();c.moveTo(lx,ly);
        c.bezierCurveTo(lx+sign*14,ly-25,lx+sign*35,ly-18,lx+sign*38,ly-25);
        c.bezierCurveTo(lx+sign*22,ly+4,lx+sign*7,ly+1,lx,ly);c.fill();
      }
      const radius=stem===0?11:7;
      for(let petal=0;petal<5;petal++){
        const angle=petal*Math.PI*2/5-.3;
        c.fillStyle=['#eae8d8','#e7d69b','#dfbbcb'][variant-4];c.beginPath();
        c.ellipse(x+Math.cos(angle)*radius*.8,y+Math.sin(angle)*radius*.8,radius*.8,radius*.48,angle,0,Math.PI*2);c.fill();
      }
      c.fillStyle='#bd9846';c.beginPath();c.ellipse(x,y,radius*.32,radius*.32,0,0,Math.PI*2);c.fill();
    }
    c.restore();
  }
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  texture.anisotropy=4;return texture;
}
