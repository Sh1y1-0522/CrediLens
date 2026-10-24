from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '01_正式文档' / '07_CrediLens_项目升级方案.docx'
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.top_margin, sec.bottom_margin = Inches(.72), Inches(.7)
sec.left_margin = sec.right_margin = Inches(.8)
sec.footer_distance = Inches(.3)

def font(style, cn, size, bold=False):
    style.font.name = 'Arial'
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = RGBColor(0, 0, 0)
    rf = style.element.get_or_add_rPr().get_or_add_rFonts()
    for k, v in [('eastAsia', cn), ('ascii', 'Arial'), ('hAnsi', 'Arial')]:
        rf.set(qn('w:'+k), v)
    for key in ['eastAsiaTheme', 'asciiTheme', 'hAnsiTheme', 'cstheme']:
        rf.attrib.pop(qn('w:'+key), None)

font(doc.styles['Normal'], '宋体', 11)
normal = doc.styles['Normal'].paragraph_format
normal.line_spacing = 1.3
normal.space_after = Pt(7)
normal.widow_control = True
font(doc.styles['Title'], '黑体', 22, True)
doc.styles['Title'].paragraph_format.space_after = Pt(10)
font(doc.styles['Subtitle'], '宋体', 10.5)
doc.styles['Subtitle'].paragraph_format.space_after = Pt(12)
for name, size in [('Heading 1', 15), ('Heading 2', 12)]:
    font(doc.styles[name], '黑体', size, True)
    doc.styles[name].paragraph_format.space_before = Pt(13)
    doc.styles[name].paragraph_format.space_after = Pt(7)
    doc.styles[name].paragraph_format.keep_with_next = True
font(doc.styles['Caption'], '宋体', 9.5)
doc.styles['Caption'].font.italic = False

def p(text, bold=False):
    para = doc.add_paragraph()
    para.add_run(text).bold = bold
    return para

def h(text):
    return doc.add_heading(text, level=2)

def page(title):
    doc.add_page_break()
    return doc.add_heading(title, level=1)

def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.autofit = False
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for col, width in zip(t.columns, widths):
        col.width = Inches(width)
    for vals in [headers] + rows:
        cells = t.rows[0].cells if vals is headers else t.add_row().cells
        for i, (cell, text) in enumerate(zip(cells, vals)):
            cell.width = Inches(widths[i])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.text = str(text)
            tcpr = cell._tc.get_or_add_tcPr()
            margins = OxmlElement('w:tcMar')
            for side in ['top', 'left', 'bottom', 'right']:
                el = OxmlElement('w:'+side)
                el.set(qn('w:w'), '95' if side in ['top', 'bottom'] else '115')
                el.set(qn('w:type'), 'dxa')
                margins.append(el)
            tcpr.append(margins)
            shade = OxmlElement('w:shd')
            shade.set(qn('w:fill'), 'E9EDF0' if vals is headers else ('F7F8F9' if len(t.rows)%2 == 0 else 'FFFFFF'))
            tcpr.append(shade)
            for para in cell.paragraphs:
                para.paragraph_format.space_after = Pt(0)
                para.paragraph_format.line_spacing = 1.18
                for run in para.runs:
                    run.font.size = Pt(10)
                    run.bold = vals is headers
        row = cells[0]._tc.getparent()
        pr = row.get_or_add_trPr()
        pr.append(OxmlElement('w:cantSplit'))
        if vals is headers:
            pr.append(OxmlElement('w:tblHeader'))
    borders = OxmlElement('w:tblBorders')
    for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        el = OxmlElement('w:'+side)
        for key, value in [('val', 'single'), ('sz', '4'), ('color', 'D9D9D9')]:
            el.set(qn('w:'+key), value)
        borders.append(el)
    t._tbl.tblPr.append(borders)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return t

doc.add_paragraph('CrediLens 项目升级方案', style='Title')
doc.add_paragraph('校园反诈识别助手　从 1.1 到参赛交付版本', style='Subtitle')
p('编制日期：2026年10月21日　　适用团队：一名负责人和两位新手')
p('本轮建议优先完成真实模型接入、截图文字核对、风险判断改进和独立评测。保留现有原生网页与 Node.js 后端，逐项增加可验证能力，并在提交前预留一周用于测试、视频和技术文档。')
h('一 当前基础与主要缺口')
table(['模块', '1.1 实际状态', '本轮补齐内容'], [
    ['产品流程', '输入、原文证据、处置、练习、导出已贯通', '增加真实分析步骤及人工复核'],
    ['模型与截图', '模型接口已写好；当前默认本地规则，截图可预览', '真实模型联调、识图结果编辑与确认'],
    ['判断与知识', '四档结论、URL 结构检查、10 条关键词检索知识', '语境纠错、精确来源与引用支持校验'],
    ['验证与交付', '40 项自动测试、30 条自建回归样本、响应式检查', '留出测试集、真实模型评测与参赛材料'],
], [1.05, 2.9, 2.95])
p('现有测试说明功能按预期运行。30 条样本属于自建工程回归集，不能据此宣传真实场景准确率；真实模型和视觉能力还需要配置服务后验证。')
h('二 版本范围与取舍')
table(['阶段', '目标与交付', '建议内部截止'], [
    ['1.2 必做', '真实模型、可修正截图文字、语境复核、过程状态、首版评测', '10月31日'],
    ['1.3 完善', '知识与引用质量、留出集评测、部署候选版、用户测试', '11月7日功能冻结'],
    ['提交准备', '回归修复、技术文档、视频、离线备份与换机复核', '11月15日最终包'],
], [1.05, 4.45, 1.4])
p('进度按每人每天约2至4小时估算。复杂账号体系、多租户、浏览器插件和主动扫描暂不进入本轮；向量检索由检索评测结果决定是否加入。赛事日期和提交格式需在第1天依据最新官方通知复核。')

page('三 真实模型与截图识别')
h('任务 A 接入一个主模型')
p('负责人先选一个支持结构化 JSON 的文本模型；若其兼容视觉输入，可同时用于截图识别。先验证接口、输出格式、限额和费用，再固定模型版本与提示词版本，避免边开发边更换服务。')
p('沿用 model.js 的服务端适配层和 .env 配置。补充请求编号、实际模型名、提示词版本、耗时、调用结果与降级原因。日志默认只保存这些元数据，不保存原始聊天、图片、密钥或完整请求体。')
p('验收：至少10条文本用例在真实服务完成调用；格式异常、限流、超时和断网均有明确状态与本地回退。结果页与导出报告准确标注分析来源，不能把本地回退显示为模型成功。')
h('任务 B 将截图识别拆成可确认的步骤')
p('建议流程为：选择截图、检查隐私、授权识别、展示文字、用户修正、确认后分析。第一轮识图只负责转录，第二轮分析使用确认后的文字，减少错字直接进入风险判断的影响。')
p('图片文字标为“模型识别，待核对”；用户确认后记录文字版本，并清除旧版本对应的结果。对看不清的内容标记缺失，不补写账号、金额或姓名。识图失败允许用户手工填写文字继续。')
p('截图中个人信息必须在上传前遮盖。本轮可先保留手动处理；有余力再增加本地矩形遮盖和遮盖后预览，确保上传的是实际处理后的图片。')
table(['负责人', '主要改动位置', '验收证据'], [
    ['负责人', 'model.js、server.js；识别与分析分开的接口契约', '真实响应样本、请求元数据、失败回退记录'],
    ['新手 A', 'app.js、index.html；文字编辑、确认、重试与清空状态', '截图演示、键盘操作与取消测试'],
    ['新手 B', '至少12张脱敏教学截图，含模糊与部分遮挡样本', '人工转录、关键金额和操作要求核对表'],
], [.8, 3.35, 2.75])
h('接入决策')
p('当单模型不能稳定完成识图时，可采用独立 OCR 加文本模型。先用相同截图比较转录质量、费用与延迟，再决定；不同时维护多套复杂识图链路。真实凭据与可用额度是联调前置条件，收费以所选服务实际计价为准。')

page('四 改进判断与分析过程')
h('任务 C 允许有依据地修正规则误报')
p('当前本地规则命中后，模型不能下调风险等级。这能防止模型忽略明显线索，但也会保留反诈宣传、引用和转述中的误报。升级时应把“发现关键词”与“对方实际要求危险操作”分开判断。')
p('建议为每条候选证据增加原文位置、所属语句、语境类别和复核状态。语境类别至少包括实际要求、禁止提醒、引用转述、信息不完整。模型可提出撤销某条候选证据，但必须引用相应语句并说明原因。')
p('普通规则线索经校验后允许修正。涉及索要验证码、转账和远程控制的冲突判断，先提示“存在分歧，需人工核验”；保留原始命中、模型解释及用户复核记录，避免直接宣告安全。')
p('“低风险”仍表示暂未发现明显高危信号，不代表已经验证来源。待核验保持不评分；分数只作启发式指标，先不显示为置信度或诈骗概率。')
table(['对照样例', '应有行为'], [
    ['“请把验证码发给我”', '识别实际凭据请求，给出原文证据与账号保护建议'],
    ['“保卫处提醒不要提供验证码”', '识别为禁止提醒，不因“验证码”直接判高风险'],
    ['“别人让我交保证金，这正常吗”', '识别转述中的风险事项，提醒核验，说明不是用户在索款'],
    ['“有个兼职，可以了解一下”', '信息不足，输出待核验并提示需要补充什么'],
], [3.15, 3.75])
h('任务 D 展示实际发生的分析步骤')
p('前端通过服务端事件或可查询任务状态展示：校验与脱敏、截图转录、规则和链接解析、知识检索、模型分析、证据校验、报告完成。每步显示等待、进行中、完成、失败、跳过或取消及实际耗时。')
p('本地模式只显示本地实际执行的步骤，未调用模型或未识图时标记跳过。取消后丢弃旧请求响应，禁止旧结果覆盖新输入；编辑内容后提示旧报告对应的是此前输入。')
p('验收：连续测试取消、重试、切换样例、编辑后重新分析和模型回退，状态与最终来源一致；过程记录可导出，且不暴露用户原文或密钥。')

page('五 知识来源与独立评测')
h('任务 E 整理可以核查的知识条目')
p('先把现有10条知识的来源补到具体文章或指南页面，建议扩充至30至50条高质量条目。每条包括编号、标题、适用场景、摘要、原文支持片段、来源网址、发布或更新日期、团队核验日期与版本。无法定位原文的内容保留为项目经验，不作为权威引用。')
p('建立约20条检索查询及人工相关条目，记录关键词检索 Top 3 是否找到可用依据。只有出现同义表达等明显召回不足，才在独立分支比较关键词与向量混合检索；确认效果提升后合并。')
p('报告分别展示输入证据与参考知识。引用必须支持对应解释，附片段和来源；原文中存在某句仅证明引用位置正确，不能证明该句是真的，也不能证明知识支持结论。截图分析应在确认文字后重新检索。')
h('任务 F 分开开发样本与留出样本')
p('建议新建100条脱敏标注样本，其中60条开发集用于调规则和提示词，40条留出集用于版本验收。现有12条演示和30条回归样本单独维护；相同模板的改写和同一聊天的截图归入同一集合，避免近重复泄漏。')
table(['标签', '开发集', '留出集', '标签定义'], [
    ['高风险', '24', '16', '明显危险操作要求或多项风险叠加'],
    ['中风险', '12', '8', '存在异常，需要核验后再决定'],
    ['低风险', '12', '8', '有核验线索，未发现明显危险要求'],
    ['待核验', '12', '8', '信息不足、语境不清或判断冲突'],
], [1.0, .8, .8, 4.3])
p('标签表示团队约定的内容风险等级，不是司法意义上的诈骗事实。每条标注风险片段、语境、建议动作及应引用的知识；两人独立标注后由负责人裁定分歧。文字与图片、正常提醒、引用转述、谐音和指令干扰应跨标签覆盖。')
p('比较三种配置：本地规则、模型不提供检索摘要、模型提供检索摘要。固定样本、模型参数、提示词版本与代码版本；留出集最终方案运行3次，观察结论变化。首次结果完整保留，不能只挑成功样例。')

page('六 验收指标与质量控制')
p('以下均为建议内部目标，需完成真实模型基线后确认。每项同时报告分子、分母及失败案例；样本量较小时，百分比只用于发现问题。未达到目标时记录原因并修复或缩小展示范围。')
table(['指标', '计算或检查方法', '建议目标'], [
    ['高风险召回', '留出集高风险中被判高风险的条数；另报判为中风险、低风险及待核验的分布', '至少14/16'],
    ['正常样本高误报', '8条低风险留出样本中被判高风险的条数；另报中风险误报', '高风险误报0/8'],
    ['证据正确率', '人工确认确有风险且解释符合语境的证据数 / 全部输出风险证据数', '不低于90%'],
    ['引用支持率', '人工确认支持对应解释的引用数 / 全部输出引用数', '不低于90%'],
    ['模型结构成功率', '无需回退即通过结构和引句检查的请求数 / 模型请求总数', '不低于95%'],
    ['留出结论稳定性', '3次运行标签完全一致的样本数 / 40；列出所有不一致样本', '至少36/40'],
    ['交互与耗时', '首个可见状态；文本与图片耗时分别统计中位数及P95；超时单列', '状态1秒内；文本P95目标25秒内'],
    ['用户任务完成', '5名测试者独立分析并理解下一步核验动作；记录所需时间与误解', '至少4/5完成'],
], [1.25, 4.15, 1.5])
h('隐私与异常验收')
p('检查报告、导出、日志、浏览器网络请求和代码仓库中的常见敏感字段。账号凭据、原图与密钥不进入审计元数据。脱敏不能覆盖全部姓名和地址，应给用户上传前复核机会。人工纠错只改当前报告，不自动污染知识库。')
p('覆盖空输入、超长内容、无效 URL、伪装主机、损坏图片、未授权截图、接口限流、响应非 JSON、证据编造和模型超时。图片无法识别时显示待核验并允许文字继续；界面、导出与历史记录一致。')
p('已存在40项自动测试与30条回归样本应持续通过；增加语境纠错、截图文字版本、事件状态、取消竞态和引用支持检查。对真实模型失败另外保留脱敏案例，不用模拟测试代替真实验证。')

page('七 三人分工与实施计划')
table(['角色', '主要责任', '每周可验收产物'], [
    ['负责人', '模型与接口、规则复核、状态契约、部署、审查及分歧裁定', '可运行版本、接口说明、模型基线与合并记录'],
    ['新手 A', '截图文字编辑、分析步骤、证据复核、响应式和异常交互', '可演示页面、状态测试、桌面与手机截图'],
    ['新手 B', '知识来源、样本标注、评测执行、用户测试和材料', '版本化样本、来源清单、结果表与演示稿'],
], [.85, 3.25, 2.8])
p('标注由新手 B 与另一名成员分别完成，负责人裁定分歧；验收由非实现者复查。每天同步一次接口和阻塞事项，每项任务通过后再合并，保证主版本随时可运行。')
table(['时间', '工作重点', '阶段完成条件'], [
    ['10月21日至23日', '复核赛事通知；确认模型和费用上限；跑通真实接口；整理标注规范', '真实文本成功；截图路线确定；版本与指标口径固定'],
    ['10月24日至27日', '识图后文字编辑确认；语境复核；分析步骤；开发集初版', '正常、异常、截图、待核验均走通；取消不覆盖新结果'],
    ['10月28日至31日', '来源补齐；开发集评测；修复主要误报与回退问题', '1.2可演示；模型基线、失败清单和来源记录齐全'],
    ['11月1日至4日', '完成留出集；配置对照实验；按结果决定是否混合检索', '留出集冻结；对照结果能复现；不随测试结果改标签'],
    ['11月5日至7日', '5人用户测试；候选部署；回归及来源复核', '1.3功能冻结；未解决问题有明确影响与处置'],
    ['11月8日至12日', '修高优先级问题；文档、视频初版；本地与线上故障演练', '演示脚本与代码版本一致；材料引用真实数据'],
    ['11月13日至15日', '换机验收；检查打包、权限、密钥与提交回执', '最终包和备份完成；留出上传与故障处理缓冲'],
], [1.35, 3.05, 2.5])
p('以上为内部排期，不替代官方截止时间。若模型接入延误超过2天，先锁定一个可用文本模型，截图保留手工转录路径；若第2周进度落后，先延后混合检索和图片区域定位，保障证据、评测与交付。')

page('八 部署交付与启动清单')
h('上线前补齐访问与配额控制')
p('现有 server.js 仅监听本机，并限制主机与来源。公网部署需单独处理环境配置、合法主机列表、HTTPS反向代理、评审访问、跨来源策略与请求配额，不能只把监听地址改成 0.0.0.0。')
p('评审演示建议提供受控访问方式和单次任务上限。模型预算由团队先定总上限 B 和单日上限 D，用试跑记录的文字及图片单次成本估计测试量；服务端执行配额，接近上限时提示并回到本地模式。费用记录按服务商实际用量核对，不预设固定价格。')
p('线上故障时保留可离线运行的规则版、脱敏样例和预录关键流程。预计算或预录结果应明确标记，演示中说明当前使用的是实时模型、本地规则还是预录内容。')
h('最终交付物')
table(['交付物', '最低内容'], [
    ['代码与运行包', '版本标签、依赖与启动说明、环境变量模板、离线资源、测试命令'],
    ['评测与数据说明', '样本字段、标签规范、分组与来源、模型及提示词版本、指标和失败案例'],
    ['知识与安全说明', '精确来源清单、数据处理流程、权限边界、日志保留与预算限制'],
    ['视频与技术文档', '问题、完整流程、真实AI证据、对照实验、局限与分工；时长与格式按官方通知'],
    ['评审与备份', '可访问地址、必要的评审凭据、换机验收记录、本地演示与提交回执'],
], [1.4, 5.5])
h('开始升级前的第一批任务')
p('1. 负责人建立1.2任务清单，确认可用模型、视觉支持与预算；用3条文字和2张脱敏截图验证接口。')
p('2. 新手 A 在当前页面完成“识别文字、编辑、确认、分析”的交互草图，列出加载、失败、取消和输入已变更状态。')
p('3. 新手 B 整理首批20条开发样本和10条精确知识来源，另一名成员复核标签与来源支持关系。')
p('4. 三人用同一组正常通知、索要验证码、信息不足和模糊截图演示一次，记录差异后再进入完整开发。')
h('本方案对应的项目资料')
p('实现基线：CrediLens1.0 目录中的 README.md、engine.js、model.js、server.js 及 tests。原有项目书、负责人指南和演示说明应随版本同步更新，统一目录名称、技术栈、真实功能与演示口径。')

footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = footer.add_run('CrediLens 项目升级方案  |  ')
run.font.size = Pt(9)
field = OxmlElement('w:fldSimple')
field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)
doc.core_properties.title = 'CrediLens 项目升级方案'
doc.core_properties.subject = '校园反诈识别助手版本升级与参赛实施计划'
doc.core_properties.author = 'CrediLens 项目组'
doc.core_properties.keywords = 'CrediLens, 升级方案, AI Web, 评测'
OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print(OUT)
