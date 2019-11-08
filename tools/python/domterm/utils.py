import sys, traceback, base64, re
from io import BytesIO

def print_html(html, out=sys.stdout):
    out.write("\x1b]72;" + html + "\x07")

def display_html(html, overwrite=False, id='python_image', inline=False, out=sys.stdout):
    top = 'span' if inline else 'div'
    if overwrite:
        out.write("\x1b]721;"+id+";"+html+"\x07")
    else:
        out.write("\x1b]72;<"+top+" class='can-replace-children' replace-key='"+id+"' style='overflow-x: auto'>"+html+"</"+top+">\x07")

dt_display_hook = None
def set_notebook_mode(enable=True):
    def auto_display(value):
        if dt_display_hook:
            expr = dt_display_hook(value)
        if hasattr(value, "_repr_html_"):
            print_html(value._repr_html_())
            return
        sys.__displayhook__(value)
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
