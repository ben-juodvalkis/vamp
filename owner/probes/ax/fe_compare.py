"""usage: python fe_compare.py <base_name_or_id> <live_list.txt>
live_list.txt = Live's Show Similar Files names, one per line, in Live's order.
Scores each candidate metric by how well its ranking reproduces that order."""
import sqlite3, numpy as np, sys, re
import os; SP=os.path.dirname(os.path.abspath(sys.argv[0]))
import json as _json, os as _os, glob as _glob
_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "..", ".."))
_DIR = _json.load(open(_os.path.join(_ROOT, "config", "constants.json")))["paths"]["liveDatabaseDir"]
_DIR = _os.path.expanduser(_DIR)
# Newest by mtime, as /api/similar-samples picks it.
DB = max(_glob.glob(_os.path.join(_DIR, "Live-files-*.db")), key=_os.path.getmtime)
con=sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
vecs=np.load(f"{SP}/fe_vecs.npy"); ids=np.load(f"{SP}/fe_ids.npy"); pos={int(i):k for k,i in enumerate(ids)}
meta={fid:(name,h,flags,kind) for fid,name,h,flags,kind in con.execute("SELECT fv.file_id,f.name,fv.hash,f.flags,f.file_kind FROM fe_values fv JOIN files f USING(file_id)")}
base=sys.argv[1]; bid=int(base) if base.isdigit() else next(f for f,(n,*_) in meta.items() if n==base)
live=[l.strip() for l in open(sys.argv[2]) if l.strip()]
bv=vecs[pos[bid]]; bkind=meta[bid][3]
# Live's candidate rule: flags&1, same file_kind bit, then one row per hash (base first, else lowest file_id)
cand=[f for f,(n,h,fl,k) in meta.items() if fl&1 and (k&bkind)]
best={}
for f in cand:
    h=meta[f][1]; cur=best.get(h)
    if cur is None or f==bid or (cur!=bid and f<cur): best[h]=f
cand=np.array(sorted(best.values())); C=vecs[[pos[f] for f in cand]]
norms=np.linalg.norm(C,axis=1)
metrics={"L2":np.linalg.norm(C-bv,axis=1),"L1":np.abs(C-bv).sum(1),"cosine":1-(C@bv)/(norms*np.linalg.norm(bv)+1e-9),"neg_dot":-(C@bv)}
name_of=lambda f:meta[f][0]
strip=lambda s:re.sub(r"\.(wav|aiff?|flac|mp3|ogg|m4a)$","",s,flags=re.I).strip()
for label,d in metrics.items():
    order=cand[np.argsort(d)]; ranked=[strip(name_of(int(f))) for f in order]
    hits=[]; 
    for i,n in enumerate(live):
        r=next((k for k,x in enumerate(ranked) if x==strip(n)),None); hits.append(r)
    found=[r for r in hits if r is not None]
    inorder=sum(1 for a,b in zip(found,found[1:]) if a<b)
    print(f"{label:8s} found {len(found)}/{len(live)}  ranks={hits[:15]}  adjacent-pairs-in-order {inorder}/{max(len(found)-1,0)}")
print("\nbase:",bid,name_of(bid)," candidates after dedup:",len(cand))
print("L2 top-15 :",[strip(name_of(int(f))) for f in cand[np.argsort(metrics['L2'])][:15]])
print("cos top-15:",[strip(name_of(int(f))) for f in cand[np.argsort(metrics['cosine'])][:15]])
