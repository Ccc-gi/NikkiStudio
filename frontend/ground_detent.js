// A directional detent: stop at zero, then require deliberate continued motion.
export class GroundDetent {
  constructor(distance=32){this.distance=distance;this.reset();}
  reset(){this.direction=0;this.travel=0;this.released=0;this.active=false;}
  apply(current,proposed,pixels){
    const delta=proposed-current,direction=Math.sign(delta);
    if(!direction)return current;
    if(this.active){
      if(direction!==this.direction){this.reset();return proposed;}
      this.travel+=Math.max(0,pixels);
      if(this.travel<this.distance)return 0;
      this.active=false;this.released=direction;return proposed;
    }
    if(this.released&&direction!==this.released)this.released=0;
    const crosses=(current>0&&proposed<=0)||(current<0&&proposed>=0)||
      (Math.abs(current)<1e-9&&direction!==this.released);
    if(crosses){this.active=true;this.direction=direction;this.travel=0;return 0;}
    return proposed;
  }
}
