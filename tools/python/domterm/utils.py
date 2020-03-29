import sys, traceback, base64, re, reprlib
from io import BytesIO
from itertools import islice

def print_html(html, out=sys.stdout):
    out.write("\x1b]72;" + html + "\x07")

def display_html(html, overwrite=False, name='python_image', inline=False, out=sys.stdout):
    top = 'span' if inline else 'div'
    if overwrite:
        out.write("\x1b]721;"+name+";"+html+"\x07")
    else:
        out.write("\x1b]72;<"+top+" class='can-replace-children' replace-key='"+name+"' style='overflow-x: auto'>"+html+"</"+top+">\x07")

def _possibly_sorted(x):
    # Since not all sequences of items can be sorted and comparison
    # functions may raise arbitrary exceptions, return an unsorted
    # sequence in that case.
    try:
        return sorted(x)
    except Exception:
        return list(x)

class DtRepr(reprlib.Repr):
    def __init__(self, indent=1):
        super(DtRepr,self).__init__()
        self.indent_per_level = int(indent)
    def repr1(self, x, level):
        if hasattr(x, "_repr_html_"):
            return "\x1b]72;" + x._repr_html_() + "\x07"
        return super().repr1(x, level)
    def _repr_iterable(self, x, level, left, right, maxiter, trail=''):
        n = len(x)
        if level <= 0 and n:
            s = '...'
        else:
            newlevel = level - 1
            repr1 = self.repr1
            indent = self.indent_per_level
            pieces = [repr1(elem, newlevel) for elem in islice(x, maxiter)]
            if n > maxiter:  pieces.append('...')
            s = ',\x1b]115;"",""," "\x07'.join(pieces)
            if n == 1 and trail:  right = trail + right
        return '\x1b]110\x07\x1b]112;%d\x07%s%s%s\x1b]111\x07' % (indent,left, s, right)
    def repr_dict(self, x, level):
        n = len(x)
        if n == 0: return '{}'
        if level <= 0: return '{...}'
        newlevel = level - 1
        indent = self.indent_per_level
        repr1 = self.repr1
        pieces = []
        for key in islice(_possibly_sorted(x), self.maxdict):
            keyrepr = repr1(key, newlevel)
            valrepr = repr1(x[key], newlevel)
            pieces.append('\x1b]110\x07\x1b]112;%d\x07%s:\x1b]115;"",""," "\x07%s\x1b]111\x07' % (indent, keyrepr, valrepr))
        if n > self.maxdict: pieces.append('...')
        s = ',\x1b]115;"",""," "\x07'.join(pieces)
        return '\x1b]110\x07\x1b]112;%d\x07{%s}\x1b]111\x07' % (indent, s)

dt_repr = DtRepr()

dt_display_hook = None
def set_notebook_mode(enable=True):
    def auto_display(value):
        if dt_display_hook:
            expr = dt_display_hook(value)
        sys.stdout.write(dt_repr.repr(value))
    if enable:
        sys.displayhook = auto_display
    else:
        sys.displayhook = sys.__displayhook__

def dt_excepthook(type, value, tb):
    t = traceback.format_exception(type, value, tb)
    r  = ""
    pat = re.compile('  File "(.*)", line ([0-9]+)(.*)')
    for tl in t:
        lines = tl[:-1].split('\n')
        m = pat.match(lines[0])
        if m and m.group(1) != '<stdin>':
            upath = m.group(1) # FIXME should URL-escape
            lines[0] = ('  \x1b]8;;file://' + upath
                + '#position=' + m.group(2) + '\x07File "' + m.group(1)
                + '", line ' + m.group(2) + '\x1b]8;;\x07' + m.group(3))
        for tll in lines:
            r = r + "\x1b[12u"
            r = r + tll
            r = r + "\x1b[11u\n"
    sys.stdout.write(r)

sys.excepthook = dt_excepthook
