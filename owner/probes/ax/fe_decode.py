import sqlite3, struct, numpy as np, collections, sys
import json as _json, os as _os, glob as _glob
_ROOT = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "..", ".."))
_DIR = _json.load(open(_os.path.join(_ROOT, "config", "constants.json")))["paths"]["liveDatabaseDir"]
_DIR = _os.path.expanduser(_DIR)
# Newest by mtime, as /api/similar-samples picks it.
DB = max(_glob.glob(_os.path.join(_DIR, "Live-files-*.db")), key=_os.path.getmtime)
con=sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows=con.execute("SELECT fv.file_id, fv.data, fv.hash, f.name FROM fe_values fv JOIN files f USING(file_id)").fetchall()
hdr=collections.Counter(); ids=[]; names={}; vecs=np.empty((len(rows),64),dtype=np.float32)
for i,(fid,data,h,name) in enumerate(rows):
    a,b,c=struct.unpack_from("<III",data,0); hdr[(a,b,c)]+=1
    vecs[i]=np.frombuffer(data[12:],dtype="<f4"); ids.append(fid); names[fid]=name
ids=np.array(ids)
print("rows",len(rows),"header dword triples:",hdr.most_common(5))
norms=np.linalg.norm(vecs,axis=1)
print("norm min/median/max: %.4f %.4f %.4f  nan rows: %d" % (norms.min(),np.median(norms),norms.max(),int(np.isnan(vecs).any(axis=1).sum())))
print("per-dim mean(abs) range: %.3f..%.3f ; overall value range %.3f..%.3f" % (np.abs(vecs).mean(0).min(),np.abs(vecs).mean(0).max(),vecs.min(),vecs.max()))
np.save(f"{sys.argv[1]}/fe_vecs.npy",vecs); np.save(f"{sys.argv[1]}/fe_ids.npy",ids)
# example ranking for a Memphis kick if present, else first 'Kick' sample
base=[fid for fid in ids if names[fid].startswith("Kick-SessionDry-Felt-Soft")]
if not base: base=[fid for fid in ids if names[fid].lower().startswith("kick")]
b=int(base[0]); bi=int(np.where(ids==b)[0][0]); v=vecs[bi]
l2=np.linalg.norm(vecs-v,axis=1); cos=1-(vecs@v)/(norms*np.linalg.norm(v)+1e-9)
print("\nBASE:",b,names[b])
for label,d in (("L2",l2),("cosine",cos)):
    o=np.argsort(d)[:12]; print(label,"top:"); [print("  %8.4f %8d  %s" % (d[j],ids[j],names[int(ids[j])][:60])) for j in o]
print("rank agreement L2 vs cosine in top-50:", len(set(np.argsort(l2)[:50])&set(np.argsort(cos)[:50])))
