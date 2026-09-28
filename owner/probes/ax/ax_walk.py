import sys, re
from ApplicationServices import (AXUIElementCreateApplication, AXUIElementCopyAttributeValue, AXIsProcessTrusted)
import subprocess
pat=re.compile(sys.argv[1] if len(sys.argv)>1 else "similar", re.I)
print("AX trusted:", AXIsProcessTrusted())
pid=int(subprocess.run(["pgrep","-x","Live"],capture_output=True,text=True).stdout.split()[0])
app=AXUIElementCreateApplication(pid)
def attr(el,name):
    err,val=AXUIElementCopyAttributeValue(el,name,None); return val if err==0 else None
hits=[]; n=0
def walk(el,depth,path):
    global n; n+=1
    if depth>40 or n>60000: return
    role=attr(el,"AXRole"); desc=attr(el,"AXDescription"); title=attr(el,"AXTitle"); help_=attr(el,"AXHelp"); ident=attr(el,"AXIdentifier")
    text=" | ".join(str(x) for x in (role,title,desc,help_,ident) if x)
    if pat.search(text): hits.append((depth,text,attr(el,"AXPosition"),attr(el,"AXEnabled")))
    kids=attr(el,"AXChildren") or []
    for k in kids: walk(k,depth+1,path)
mw=attr(app,"AXMainWindow")
roots=[mw] if mw is not None else []
roots+= [w for w in (attr(app,"AXWindows") or []) if w is not mw]
print("roots:",len(roots))
for w in roots: walk(w,0,"")
print("elements visited:", n, "hits:", len(hits))
for h in hits[:60]: print("  depth=%d enabled=%s pos=%s :: %s" % (h[0],h[3],h[2],h[1][:140]))
