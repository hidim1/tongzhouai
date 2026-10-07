import sys,json,zipfile,subprocess,tempfile,xml.etree.ElementTree as ET
from pathlib import Path
W={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
S={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def docx(p):
 with zipfile.ZipFile(p) as z:
  root=ET.fromstring(z.read('word/document.xml'))
  text='\n'.join(''.join(x.text or '' for x in para.findall('.//w:t',W)) for para in root.findall('.//w:p',W))
  tables=[]
  for t in root.findall('.//w:tbl',W):
   tables.append([['\n'.join(''.join(x.text or '' for x in p.findall('.//w:t',W)) for p in c.findall('.//w:p',W)).strip() for c in row.findall('w:tc',W)] for row in t.findall('w:tr',W)])
  return {'text':text,'tables':tables}
def xlsx(p):
 with zipfile.ZipFile(p) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(t.text or '' for t in si.findall('.//s:t',S)) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',S)]
  rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  sheets=[]
  for sh in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',S):
   target=rels[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']];target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   rows=[]
   for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row',S):
    cells={}
    for c in row.findall('s:c',S):
     val=c.find('s:v',S);v=val.text if val is not None else ''
     if c.attrib.get('t')=='s':v=strings[int(v)] if v else ''
     elif c.attrib.get('t')=='inlineStr':v=''.join(t.text or '' for t in c.findall('.//s:t',S))
     if v:cells[c.attrib['r']]=v
    if cells:rows.append(cells)
   sheets.append({'name':sh.attrib['name'],'rows':rows})
  return {'sheets':sheets,'text':'\n'.join(s['name']+'\n'+'\n'.join(' | '.join(k+'='+str(v) for k,v in r.items()) for r in s['rows']) for s in sheets)}
p=Path(sys.argv[1]);ext=p.suffix.lower()
try:
 if ext=='.docx':result=docx(p)
 elif ext=='.doc':
  with tempfile.TemporaryDirectory() as td:
   converted=Path(td)/'converted.docx'
   subprocess.run(['textutil','-convert','docx','-output',str(converted),str(p)],check=True,capture_output=True,timeout=40)
   result=docx(converted)
 elif ext=='.xlsx':result=xlsx(p)
 elif ext in ['.txt','.md','.csv']:result={'text':p.read_text(errors='replace')}
 elif ext=='.pdf':
  from pypdf import PdfReader
  result={'text':'\n'.join(f'第{i+1}页\n'+(page.extract_text() or '') for i,page in enumerate(PdfReader(p).pages))}
 else:result={'text':'','unsupported':True}
 print(json.dumps(result,ensure_ascii=False))
except Exception as e:
 print(json.dumps({'text':'','error':str(e)},ensure_ascii=False));sys.exit(1)
