# usage: ax_act.py <pid> <press_regex|-> <list_regex>   (press first matching element's AXPress, then list matches)
import sys, re, time, subprocess
from ApplicationServices import (AXUIElementCreateApplication, AXUIElementCopyAttributeValue, AXUIElementPerformAction, AXIsProcessTrusted)
pid=int(sys.argv[1]); press_rx=sys.argv[2]; list_rx=re.compile(sys.argv[3], re.I)
app=AXUIElementCreateApplication(pid)
def attr(el,name):
    err,val=AXUIElementCopyAttributeValue(el,name,None); return val if err==0 else None
def text(el):
    return " | ".join(str(attr(el,a)) for a in ("AXRole","AXTitle","AXDescription","AXIdentifier") if attr(el,a))
def walk(root):
    out=[]; stack=[(root,0)]
    while stack:
        el,d=stack.pop(); out.append((el,d))
        if d<40:
            for k in (attr(el,"AXChildren") or []): stack.append((k,d+1))
    return out
def pos(el):
    p=attr(el,"AXPosition"); return str(p).split("value = ")[1].split(" type")[0] if p else "?"
mw=attr(app,"AXMainWindow"); print("trusted:",AXIsProcessTrusted(),"main window:",attr(mw,"AXTitle") if mw else None)
nodes=walk(mw)
if press_rx!="-":
    spec,_,at=press_rx.partition("@"); rx=re.compile(spec,re.I); tgt=[el for el,_ in nodes if rx.search(text(el))]
    if at: tgt=[el for el in tgt if pos(el).startswith("x:%s.0" % at.split(",")[0]) and ("y:%s.0" % at.split(",")[1]) in pos(el)]
    print("press candidates:",len(tgt))
    if tgt:
        el=tgt[0]; print("PRESS ->",text(el),pos(el),"value before:",attr(el,"AXValue")); t0=time.time()
        print("  AXPress result:",AXUIElementPerformAction(el,"AXPress"),"(%.0f ms)"%((time.time()-t0)*1000))
        time.sleep(0.4); print("  value after:",attr(el,"AXValue"))
        nodes=walk(mw)
hits=[(el,d) for el,d in nodes if list_rx.search(text(el))]
print("nodes:",len(nodes),"list hits:",len(hits))
for el,d in hits:
    print("  d=%d en=%s pos=%s acts=%s :: %s" % (d,attr(el,"AXEnabled"),pos(el),attr(el,"AXActionNames") and list(attr(el,"AXActionNames")),text(el)[:150]))
print("DONE")
