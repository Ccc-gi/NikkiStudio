// 彩蛋：上上下下左右左右 B A。命中后右下角弹出一只大喵吃五花肉。
//
// 进食由输入决定：不碰方向键，它自己把一整块肉吃完就走；期间按方向键会立刻多咬一口并延后离开，
// 于是一直按就一直吃，咬空了自动换新的一块。
//
// 序列只用方向键和 b/a，且不带修饰键，所以不会和 W A S D 导航、M/R/V、Ctrl+S、Shift 步进冲突；
// 输入框里不计数，避免打字误触发；全程不 preventDefault，按什么都不可能影响别的快捷键。
const SEQUENCE=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
const ARROWS=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
const BITE_INTERVAL=55;    // 每按一下都算一口，这里只挡掉同一帧的重复，不做手速节流
const AUTO_BITE_MS=320;    // 没人按的时候自己咬的节奏
const INPUT_HOLD_MS=420;   // 有输入时自动进食让位，保证「按一下正好多一口」的对应关系
const IDLE_MS=950;         // 咬空那一刻，距上次按键超过这么久就收工走人
const GRIN_MS=780;         // 收工前先呲牙笑这么久
const LEAVE_MS=700;
const FIRST_BITE_MS=420;   // 等弹出动画走完
const MEAT_STEPS=[1,.78,.5,0];   // 每咬一口剩下的份量，见底换新的一块
const MARKUP=`
<g class="kc-all">
  <g class="kc-head">
    <path d="M79 25C97 25 109 39 109 56C109 74 97 85 79 85C61 85 49 74 49 56C49 39 61 25 79 25Z" fill="#F5C24A"/>
    <path d="M55 38L51 11L76 27Z" fill="#F5C24A" stroke="#E8913A" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M103 38L107 11L82 27Z" fill="#F5C24A" stroke="#E8913A" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M59 34L57 19L71 28Z" fill="#E8913A"/>
    <path d="M99 34L101 19L87 28Z" fill="#E8913A"/>
    <path d="M79 24C75 13 82 5 91 7C85 12 83 18 84 25Z" fill="#E8913A"/>
    <ellipse cx="79" cy="57" rx="26" ry="24" fill="#FFFFFF"/>
    <path d="M64 51q5-7 10 0" fill="none" stroke="#4A3A28" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M84 51q5-7 10 0" fill="none" stroke="#4A3A28" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="61" cy="61" rx="5" ry="3.2" fill="#F3A79E"/>
    <ellipse cx="97" cy="61" rx="5" ry="3.2" fill="#F3A79E"/>
    <ellipse class="kc-mouth" cx="79" cy="66" rx="5.5" ry="4.5" fill="#8A4A3A"/>
    <!-- 吃完之后的呲牙笑：一张咧开的嘴，上排牙露出来，牙缝用竖线切。默认不显示。 -->
    <g class="kc-grin">
      <clipPath id="kc-grin-clip"><path d="M63 60Q79 86 95 60Z"/></clipPath>
      <path d="M63 60Q79 86 95 60Z" fill="#8A4A3A"/>
      <rect x="63" y="60" width="32" height="6" fill="#FFFFFF" clip-path="url(#kc-grin-clip)"/>
      <path d="M72 59.6v7M79 59.6v8.4M86 59.6v7" stroke="#8A4A3A" stroke-width="1.1" fill="none" clip-path="url(#kc-grin-clip)"/>
    </g>
    <path d="M71 87L62 81L62 95Z" fill="#C9523F"/>
    <path d="M87 87L96 81L96 95Z" fill="#C9523F"/>
    <circle cx="79" cy="88" r="4.5" fill="#C9523F"/>
    <ellipse cx="98" cy="80" rx="7" ry="6" fill="#FFFFFF" stroke="#E3C489" stroke-width="1.4"/>
  </g>
  <!-- 五花肉放在头之后，否则会被脸整个盖住；右缘贴着嘴角，缩放原点也设在那里。 -->
  <g class="kc-meat">
    <rect x="48" y="56" width="26" height="20" rx="6" fill="#b06a3f"/>
    <rect x="50.5" y="60" width="21" height="3.6" rx="1.8" fill="#f4dfc7"/>
    <rect x="50.5" y="65.6" width="21" height="3.6" rx="1.8" fill="#f4dfc7"/>
    <rect x="50.5" y="71.2" width="21" height="3.6" rx="1.8" fill="#f4dfc7"/>
    <rect x="48" y="56" width="26" height="20" rx="6" fill="none" stroke="#8a4d2c" stroke-width="1.8"/>
  </g>
</g>`;

let session=null;
let progress=0;

export function installEasterEgg(){
  const typing=target=>target instanceof Element&&target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  window.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey||typing(event.target))return;
    if(session&&ARROWS.has(event.key)){session.lastInput=performance.now();bite();return;}
    const key=event.key.length===1?event.key.toLowerCase():event.key;
    progress=key===SEQUENCE[progress]?progress+1:key===SEQUENCE[0]?1:0;
    if(progress<SEQUENCE.length)return;
    progress=0;
    begin();
  });
}

function begin(){
  if(session)return;
  document.querySelector('.konami-cat')?.remove();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','konami-cat');
  svg.setAttribute('viewBox','0 0 130 104');
  svg.setAttribute('aria-hidden','true');
  svg.innerHTML=MARKUP;
  document.body.append(svg);
  session={el:svg,meat:svg.querySelector('.kc-meat'),head:svg.querySelector('.kc-head'),mouth:svg.querySelector('.kc-mouth'),bites:-1,last:0,lastInput:0};
  session.first=setTimeout(()=>{
    if(!session)return;
    bite();
    session.auto=setInterval(()=>{if(session&&performance.now()-session.lastInput>INPUT_HOLD_MS)bite();},AUTO_BITE_MS);
  },FIRST_BITE_MS);
}

function bite(){
  if(!session)return;
  const now=performance.now();
  if(now-session.last<BITE_INTERVAL)return;
  session.last=now;
  session.bites++;
  const rest=MEAT_STEPS[session.bites%MEAT_STEPS.length];
  session.meat.style.transform=rest===0?'scale(.34,0)':`scale(${rest})`;
  for(const part of [session.head,session.mouth]){
    part.classList.remove('kc-bite');
    void part.getBoundingClientRect();   // 强制重排，动画才能重新开始
    part.classList.add('kc-bite');
  }
  // 这一块刚好吃完。没人接着按就先呲牙笑一会再走，否则下一口自己换新的一块。
  if(rest===0&&now-session.lastInput>IDLE_MS)grin();
}

function grin(){
  if(!session)return;
  clearInterval(session.auto);
  clearTimeout(session.first);
  session.el.classList.add('is-grinning');
  session.grin=setTimeout(leave,GRIN_MS);
}

function leave(){
  if(!session)return;
  const current=session;
  session=null;
  clearInterval(current.auto);
  clearTimeout(current.first);
  clearTimeout(current.grin);
  current.el.classList.remove('is-grinning');
  current.el.classList.add('is-leaving');
  setTimeout(()=>current.el.remove(),LEAVE_MS);
}
