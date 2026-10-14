"""Observed PaperBin item/localization/tag/UI hierarchy records; no shipped game data."""
import json
import re
import struct


class Reader:
    def __init__(self,data,pos=0):self.data,self.pos=data,pos
    def integer(self):
        p=self.pos
        if p>=len(self.data):raise ValueError('Truncated compact integer')
        first=self.data[p];p+=1
        if first<128:value=first
        else:
            if first<192:count,value=1,first&63
            elif first<224:count,value=2,first&31
            elif first<240:count,value=3,first&15
            elif first==240:count,value=4,0
            else:raise ValueError('Unsupported compact integer prefix')
            if p+count>len(self.data):raise ValueError('Truncated compact integer')
            for byte in self.data[p:p+count]:value=(value<<8)|byte
            p+=count
        self.pos=p;return value
    def string(self):
        size=self.integer()
        if size>65536 or self.pos+size>len(self.data):raise ValueError('Invalid compact string')
        value=self.data[self.pos:self.pos+size].decode('utf-8');self.pos+=size;return value


def resource_reference(value):
    match=re.search(r'/Game/[A-Za-z0-9_/.-]+',value)
    return match[0] if match else None


def preceding_integer(data,end):
    for size in range(5,0,-1):
        if end<size:continue
        r=Reader(data,end-size)
        try:
            value=r.integer()
            if r.pos==end:return value
        except ValueError:pass
    raise ValueError('Missing compact prefix')


def parse_catalog(data,ids):
    ids=set(map(str,ids));items={};categories={};tags={};tag_categories={}
    # Localized name records explicitly identify their owning table.
    names={}
    for hit in re.finditer(rb'ItemName_(117[0-9]{7})',data):
        ident=hit[1].decode()
        if ident not in ids:continue
        try:
            r=Reader(data,hit.end())
            if r.string()=='TbItem':
                name=r.string()
                if name:names[ident]=name
        except (ValueError,UnicodeError):pass
    for hit in re.finditer(rb'\xf0(.{4})([\x01-\x7f])ItemName_(117[0-9]{7})',data,re.S):
        ident=str(struct.unpack('>I',hit[1])[0])
        if ident not in ids or ident!=hit[3].decode():continue
        try:
            r=Reader(data,hit.start()+5)
            if r.string()!='ItemName_'+ident:continue
            r.string()  # explicit-name override
            for _ in range(6):r.integer()  # item type, item categories, flags, stack, rarity
            icon=resource_reference(r.string());r.string()
            items[ident]={'name':names.get(ident,'家具 '+ident),'sourceIcon':icon,'categoryId':'0'}
        except (ValueError,UnicodeError):pass
    # Interned gameplay tags carry IDs and parent arrays. UI rows refer to tag names.
    for hit in re.finditer(rb'HOMENEW_[A-Z_]+',data):
        try:
            start=hit.start()-1
            r=Reader(data,start)
            if r.string()!=hit[0].decode():continue
            ident=preceding_integer(data,start);tag=r.string();count=r.integer()
            if not tag.startswith('HomeNew.') or not 0<=count<=16:continue
            parents=[r.integer() for _ in range(count)]
            tags[ident]=tag
        except (ValueError,UnicodeError):pass
    for hit in re.finditer(rb'HomeNew\.[A-Za-z.]+',data):
        try:
            r=Reader(data,hit.end());ident=r.integer();text=r.string()
            if not text.startswith('NSLOCTEXT(') or 'DT_HomeObjectUIHierarchyType.' not in text:continue
            args=re.fullmatch(r'NSLOCTEXT\(("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*")\)',text)
            if not args or not 0<ident<100000:continue
            name=json.loads(args[3]);icon=r.string();r.string()
            tag=hit[0].decode();tag_categories[tag]=str(ident)
            categories[str(ident)]={'name':name,'parentId':None,'sourceIcon':icon,'tag':tag}
        except (ValueError,UnicodeError):pass
    for row in categories.values():
        parent=row['tag'].rsplit('.',1)[0]
        row['parentId']=tag_categories.get(parent)
    # The furniture UI tags are in an explicit item -> tag array record.
    for hit in re.finditer(rb'\xf0(.{4})',data,re.S):
        ident=str(struct.unpack('>I',hit[1])[0])
        if ident not in items:continue
        try:
            r=Reader(data,hit.end());count=r.integer()
            if not 0<count<=16:continue
            refs=[r.integer() for _ in range(count)]
            choices=[tag_categories[tags[x]] for x in refs if x in tags and tags[x] in tag_categories]
            if len(choices)==count:
                items[ident]['categoryId']=max(choices,key=lambda x:categories[x]['tag'].count('.'))
        except ValueError:pass
    categories['0']={'name':'未分类','parentId':None}
    report={'schema':1,'source':'current-game PaperBin','items':len(items),'named':sum(x in names for x in items),
            'classified':sum(row['categoryId']!='0' for row in items.values()),'categories':len(categories)-1,
            'missingItems':sorted(ids-set(items))}
    if not items or not categories.keys()-{'0'}:raise ValueError('家具目录格式不兼容：未找到物品或分类层级，请更新目录适配器')
    return items,categories,report
