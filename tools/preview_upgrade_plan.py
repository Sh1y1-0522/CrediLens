import html
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
src = ROOT / '01_正式文档' / '07_CrediLens_项目升级方案.docx'
out = PROJECT / 'test-results' / 'upgrade-plan'
out.mkdir(parents=True, exist_ok=True)
doc = Document(src)
pages = [[]]

def para_html(p):
    style = p.find('w:pPr/w:pStyle', p.nsmap)
    name = style.get(qn('w:val')) if style is not None else 'Normal'
    runs = []
    for run in p.findall('w:r', p.nsmap):
        text = ''.join(t.text or '' for t in run.findall('w:t', p.nsmap))
        if not text:
            continue
        bold = run.find('w:rPr/w:b', p.nsmap)
        size = run.find('w:rPr/w:sz', p.nsmap)
        css = ''
        if bold is not None and bold.get(qn('w:val')) not in ['0', 'false']:
            css += 'font-weight:bold;'
        if size is not None:
            css += f'font-size:{int(size.get(qn("w:val")))/2}pt;'
        runs.append(f'<span style="{css}">{html.escape(text)}</span>')
    tag = 'h1' if name == 'Title' else 'h2' if name == 'Heading1' else 'h3' if name == 'Heading2' else 'p'
    return f'<{tag} class="{name}">' + (''.join(runs) or '&nbsp;') + f'</{tag}>'

def table_html(t):
    widths = [int(c.get(qn('w:w'))) / 1440 for c in t.findall('w:tblGrid/w:gridCol', t.nsmap)]
    result = '<table><colgroup>' + ''.join(f'<col style="width:{w}in">' for w in widths) + '</colgroup>'
    for tr in t.findall('w:tr', t.nsmap):
        result += '<tr>'
        for cell in tr.findall('w:tc', tr.nsmap):
            shd = cell.find('w:tcPr/w:shd', cell.nsmap)
            fill = shd.get(qn('w:fill')) if shd is not None else 'FFFFFF'
            result += f'<td style="background:#{fill}">' + ''.join(para_html(p) for p in cell.findall('w:p', cell.nsmap)) + '</td>'
        result += '</tr>'
    return result + '</table>'

for node in doc.element.body:
    if node.tag == qn('w:p'):
        if any(b.get(qn('w:type')) == 'page' for b in node.findall('.//w:br', node.nsmap)):
            pages.append([])
        else:
            pages[-1].append(para_html(node))
    elif node.tag == qn('w:tbl'):
        pages[-1].append(table_html(node))

css = '''
*{box-sizing:border-box}body{margin:0;background:#ddd;color:#000;font-family:Arial,SimSun,"宋体",serif;font-size:11pt;line-height:1.3}
.sheet{width:8.5in;height:11in;background:white;padding:.72in .8in .7in;margin:0 auto;position:relative}
.content{height:9.58in;display:flow-root}p{margin:0 0 7pt;line-height:1.3}h1,h2,h3{font-family:Arial,SimHei,"黑体",sans-serif;color:black;line-height:1.3}
h1{font-size:22pt;margin:0 0 10pt}h2{font-size:15pt;margin:13pt 0 7pt}h3{font-size:12pt;margin:13pt 0 7pt}.Subtitle{font-size:10.5pt;margin-bottom:12pt}
table{border-collapse:collapse;table-layout:fixed;width:6.9in}td{border:0.5pt solid #d9d9d9;padding:4.75pt 5.75pt;vertical-align:middle;overflow-wrap:anywhere}td p{font-size:10pt;line-height:1.18;margin:0}
.footer{position:absolute;bottom:.3in;left:.8in;right:.8in;text-align:center;font-size:9pt;line-height:1.3}
'''
for index, content in enumerate(pages, 1):
    result = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>' + css + '</style><div class="sheet"><div class="content">' + ''.join(content) + f'</div><div class="footer">CrediLens 项目升级方案　|　{index}</div></div></html>'
    (out / f'page-{index}.html').write_text(result, encoding='utf-8')
print(f'{len(pages)} preview pages generated from saved OOXML')
