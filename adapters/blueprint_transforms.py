"""Resolve Blueprint SCS attachment names and inherited component templates."""
import json, math
from pathlib import Path
import numpy as np

def object_name(ref):
    return (ref or {}).get('ObjectName','').rstrip("'").split(':')[-1].split('.')[-1].split("'")[-1]

def matrix(props):
    p,y,r=[math.radians(props.get('RelativeRotation',{}).get(k,0))/2 for k in ('Pitch','Yaw','Roll')]
    sp,cp,sy,cy,sr,cr=math.sin(p),math.cos(p),math.sin(y),math.cos(y),math.sin(r),math.cos(r)
    x,y,z,w=cr*sp*sy-sr*cp*cy,-cr*sp*cy-sr*cp*sy,cr*cp*sy-sr*sp*cy,cr*cp*cy+sr*sp*sy
    m=np.eye(4)
    m[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    m[:3,:3]*=[props.get('RelativeScale3D',{}).get(k,1) for k in 'XYZ']
    m[:3,3]=[props.get('RelativeLocation',{}).get(k,0) for k in 'XYZ']
    return m

class BlueprintTransforms:
    def __init__(self, roots):
        self.packages={}
        self.paths={}
        for root in roots:
            for path in Path(root).rglob('*.json'):
                exports=json.loads(path.read_text(encoding='utf-8-sig'))
                if not isinstance(exports,list):continue
                package=next((e.get('Package') for e in exports if e.get('Type')=='BlueprintGeneratedClass'),None)
                if package:
                    self.packages[package]={e['Name']:e for e in exports}
                    self.paths[package]=path

    def properties(self, package, name, seen=None):
        seen=set() if seen is None else seen
        key=(package,name)
        if key in seen:raise ValueError('Template cycle '+str(key))
        seen.add(key)
        e=self.packages.get(package,{}).get(name)
        if e is None:raise ValueError('Missing template '+str(key))
        template=e.get('Template') or {}
        parent_package=template.get('ObjectPath','').rsplit('.',1)[0]
        # Engine class defaults have identity transform; external authored
        # Blueprint templates must be available rather than silently ignored.
        inherited={}
        if parent_package.startswith('/Game/'):
            inherited=self.properties(parent_package,object_name(template),seen)
        return {**inherited,**(e.get('Properties') or {})}

    def component(self, package, name):
        exports=self.packages[package]
        parents={}
        for e in exports.values():
            if e['Type']!='SCS_Node':continue
            props=e.get('Properties') or {}
            child=object_name(props.get('ComponentTemplate'))
            parent=props.get('ParentComponentOrVariableName')
            if parent:
                parents[child]=parent if props.get('bIsParentComponentNative') else parent+'_GEN_VARIABLE'
            for ref in props.get('ChildNodes',[]):
                node=exports.get(object_name(ref))
                if node:parents[object_name((node.get('Properties') or {}).get('ComponentTemplate'))]=child
        chain=[]
        def world(current):
            if current in chain:raise ValueError('Attachment cycle '+current)
            chain.append(current)
            props=self.properties(package,current)
            parent=parents.get(current) or object_name(props.get('AttachParent'))
            local=matrix(props)
            # The native mesh-root calibration is specific to this ancestor,
            # not to the actor or all Blueprint meshes. Explicit authored
            # rotation takes precedence over the calibrated preview default.
            if current=='StaticMeshRoot' and 'RelativeRotation' not in props:
                local=matrix({**props,'RelativeRotation':{'Yaw':-90}})
            return world(parent)@local if parent else local
        result=world(name)
        return result,chain
