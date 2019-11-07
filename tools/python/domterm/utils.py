import sys, traceback, base64, re
from io import BytesIO

def print_html(html):
    sys.stdout.write("\x1b]72;" + html + "\x07")

def fac(x):
    return x * x / x * fac(x - 1)
def odd(x):
    return x * x / x * even(x - 1)
def even(x):
    return x * x / x * odd(x - 1)
    
def display_data(content_type, content, overwrite=False, toggle=False, display="block", exit_page=False, stderr=False):
    """Display data of specified content type. May be untrusted images.
    toggle allows images to be hidden by clicking.
    """

    params = ""
    #if overwrite:
    #    params += " overwrite='yes'"
    if toggle:
        params += " toggle='yes'"
    if exit_page:
        params += " exit_page='yes'"

    id = "python_image"
    html = '<img %s src="data:%s;base64,%s"/>' % (params, content_type, base64.b64encode(content).decode())
    out = sys.stderr if stderr else sys.stdout
    if overwrite:
        out.write("\x1b]721;"+id+";"+html+"\x07")
    else:
        out.write("\x1b]72;<div class='can-replace-children' replace-key='"+id+"' style='overflow-x: auto'>"+html+"</div>\x07")

class BlobBytesIO(BytesIO):
    def __init__(self, max_bytes=25000000):
        self.blob_max_bytes = max_bytes
        BytesIO.__init__(self)

    def write(self, s):
        if self.tell()+len(s) > self.blob_max_bytes:
            raise RuntimeError("Blob size exceeds limit of %s bytes" % self.blob_max_bytes)
        BytesIO.write(self, s)

    def close(self):
        data = self.getvalue()
        BytesIO.close(self)
        return data

#Saved_displayhook = sys.displayhook
def set_notebook_mode(enable=True):
    def auto_display(value):
        if "display_hook" in globals():
            expr = globals()["display_hook"](value)
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
