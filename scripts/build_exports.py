#!/usr/bin/env python3
from pathlib import Path
import csv, json, zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
RECORDS=DATA/"records"
EXPORTS=ROOT/"exports"
EXPORTS.mkdir(exist_ok=True)

HEADERS=[
 "UTM ID","Campaign ID","Campaign Name","utm_campaign","Source","utm_source","Medium","utm_medium",
 "Creative ID","Creative Name","utm_content","Audience","utm_term","Destination URL","Final URL",
 "Placement","Publish Date","Created By","Username","Created At","Status","Notes"
]

def load_json(path, default):
    if not path.exists(): return default
    return json.loads(path.read_text(encoding="utf-8"))

def load_records():
    out=[]
    for path in sorted(RECORDS.glob("*.json")):
        try:
            data=load_json(path,[])
            if isinstance(data,list): out.extend(data)
        except Exception as exc:
            print(f"Skipping {path.name}: {exc}")
    return sorted(out,key=lambda r:r.get("createdAt",""),reverse=True)

def snap(record,key,subkey="value"):
    obj=record.get(key) or {}
    return obj.get(subkey,"") if isinstance(obj,dict) else ""

def flat(record):
    created_by=record.get("createdBy") or {}
    return {
      "UTM ID":record.get("id",""),
      "Campaign ID":snap(record,"campaign","id"),
      "Campaign Name":snap(record,"campaign","displayName"),
      "utm_campaign":snap(record,"campaign"),
      "Source":snap(record,"source","displayName"),
      "utm_source":snap(record,"source"),
      "Medium":snap(record,"medium","displayName"),
      "utm_medium":snap(record,"medium"),
      "Creative ID":snap(record,"creative","id"),
      "Creative Name":snap(record,"creative","displayName"),
      "utm_content":snap(record,"creative"),
      "Audience":snap(record,"audience","displayName"),
      "utm_term":snap(record,"audience"),
      "Destination URL":record.get("destinationUrl",""),
      "Final URL":record.get("finalUrl",""),
      "Placement":record.get("placement",""),
      "Publish Date":record.get("publishDate",""),
      "Created By":created_by.get("name",""),
      "Username":created_by.get("username",""),
      "Created At":record.get("createdAt",""),
      "Status":record.get("status",""),
      "Notes":record.get("notes","")
    }

def write_csv(records):
    path=EXPORTS/"utm_history.csv"
    with path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=HEADERS);w.writeheader()
        for r in records:w.writerow(flat(r))
    return path

def col_name(number):
    result=""
    while number:
        number,rem=divmod(number-1,26)
        result=chr(65+rem)+result
    return result

def xml_text(value):
    return escape("" if value is None else str(value), {'"':"&quot;"})

def sheet_xml(rows):
    parts=['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for ri,row in enumerate(rows,1):
        parts.append(f'<row r="{ri}">')
        for ci,value in enumerate(row,1):
            ref=f"{col_name(ci)}{ri}"
            style=' s="1"' if ri==1 else ''
            parts.append(f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{xml_text(value)}</t></is></c>')
        parts.append("</row>")
    parts.append("</sheetData></worksheet>")
    return "".join(parts)

def definition_rows(definitions,key):
    items=definitions.get(key,[]) or []
    keys=[]
    for item in items:
        for k in item:
            if k not in keys: keys.append(k)
    if not keys: keys=["id","displayName","value","status"]
    return [keys]+[[item.get(k,"") for k in keys] for item in items]

def write_xlsx(records,definitions):
    rows=[HEADERS]+[[flat(r).get(h,"") for h in HEADERS] for r in records]
    sheets=[
      ("UTM Links",rows),
      ("Campaigns",definition_rows(definitions,"campaigns")),
      ("Sources",definition_rows(definitions,"sources")),
      ("Mediums",definition_rows(definitions,"mediums")),
      ("Content Types",definition_rows(definitions,"contentTypes")),
      ("Creatives",definition_rows(definitions,"creatives")),
      ("Audiences",definition_rows(definitions,"audiences")),
      ("Meta",[
        ["Metric","Value"],
        ["Generated At UTC",datetime.now(timezone.utc).isoformat()],
        ["Total Records",len(records)],
        ["Active",sum(1 for r in records if r.get("status")=="active")],
        ["Archived",sum(1 for r in records if r.get("status")=="archived")],
        ["Deleted",sum(1 for r in records if r.get("status")=="deleted")]
      ])
    ]

    path=EXPORTS/"utm_history.xlsx"
    overrides="".join(
      f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      for i in range(1,len(sheets)+1)
    )
    content_types=(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + overrides + '</Types>'
    )
    root_rels=(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      '</Relationships>'
    )
    wb_sheets="".join(f'<sheet name="{xml_text(name)}" sheetId="{i}" r:id="rId{i}"/>' for i,(name,_) in enumerate(sheets,1))
    workbook=(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      f'<sheets>{wb_sheets}</sheets></workbook>'
    )
    rels="".join(
      f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
      for i in range(1,len(sheets)+1)
    )
    rels+=f'<Relationship Id="rId{len(sheets)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    workbook_rels=(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + rels + '</Relationships>'
    )
    styles=(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      '<fonts count="2"><font/><font><b/></font></fonts>'
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      '<borders count="1"><border/></borders>'
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs>'
      '</styleSheet>'
    )

    with zipfile.ZipFile(path,"w",zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",content_types)
        z.writestr("_rels/.rels",root_rels)
        z.writestr("xl/workbook.xml",workbook)
        z.writestr("xl/_rels/workbook.xml.rels",workbook_rels)
        z.writestr("xl/styles.xml",styles)
        for i,(_,sheet_rows) in enumerate(sheets,1):
            z.writestr(f"xl/worksheets/sheet{i}.xml",sheet_xml(sheet_rows))
    return path

def main():
    records=load_records()
    definitions=load_json(DATA/"definitions.json",{})
    print("Generated:",write_csv(records))
    print("Generated:",write_xlsx(records,definitions))

if __name__=="__main__":
    main()
