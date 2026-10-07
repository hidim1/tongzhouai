import sys,os,json,subprocess
from contextlib import redirect_stdout
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.cad-deps'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
import ezdxf
from ezdxf.addons.drawing import RenderContext,Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.addons.drawing.config import Configuration,BackgroundPolicy,ColorPolicy
from ezdxf import disassemble
source=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
if source.suffix.lower()=='.dwg':
 dxf=out/'process.dxf'
 r=subprocess.run(['/opt/homebrew/bin/dwg2dxf','-y','-o',str(dxf),str(source)],capture_output=True,text=True,timeout=50)
 (out/'conversion.log').write_text(r.stdout+r.stderr)
 if not dxf.exists():raise RuntimeError('DWG 转换未生成 DXF：'+r.stderr[-300:])
else:dxf=source
try:doc=ezdxf.readfile(dxf)
except ezdxf.DXFStructureError:
 from ezdxf import recover
 doc,auditor=recover.readfile(dxf)
space=doc.modelspace();texts=[];entity_count=0
for e in disassemble.recursive_decompose(space):
 entity_count+=1
 if e.dxftype() in ('TEXT','ATTRIB','ATTDEF'):
  texts.append(e.dxf.text)
 elif e.dxftype()=='MTEXT':texts.append(e.plain_text())
# Matplotlib and ezdxf resolve available local fonts; no network fonts required.
plt.rcParams['font.family']=['Arial Unicode MS','PingFang SC','DejaVu Sans']
fig=plt.figure(figsize=(22,14),dpi=140);ax=fig.add_axes([0,0,1,1]);ax.set_axis_off()
ctx=RenderContext(doc);backend=MatplotlibBackend(ax)
config=Configuration(background_policy=BackgroundPolicy.WHITE,color_policy=ColorPolicy.BLACK)
with redirect_stdout(sys.stderr):
 Frontend(ctx,backend,config=config).draw_layout(space,finalize=True)
preview=out/'process.png';fig.savefig(preview,dpi=140,bbox_inches='tight',pad_inches=0.12);plt.close(fig)
text='\n'.join(dict.fromkeys(t.strip() for t in texts if t and t.strip()))
(out/'texts.txt').write_text(text)
print(json.dumps({'preview':str(preview.resolve()),'text':text,'stats':{'entities':entity_count,'textItems':len(texts)},'note':'DWG 经 LibreDWG 转 DXF 后渲染；部分字体、代理对象或块可能不完整。图中文字为候选证据，尚未完成图元计数与连接关系校验。'},ensure_ascii=False))
