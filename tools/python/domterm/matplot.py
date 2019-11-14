from __future__ import absolute_import, print_function

import time, sys, base64
from io import BytesIO, StringIO
import domterm.utils as dtutils

pyplot_dict = {}

def setup(nopatch=False, figsize="4.0, 3.0"):
    """Setup gterm-aware matplotlib.
    Note: Must be called before importing matplotlib
    If nopatch, do not patch the draw/figure/show functions of pyplot/pylab.
    """
    import matplotlib
    matplotlib.use("Agg")
    if figsize:
        matplotlib.rcParams["figure.figsize"] = figsize

    import matplotlib.pyplot
    import pylab
    pyplot_dict["new_cell"] = False
    pyplot_dict["new_plot"] = True
    pyplot_dict["drawing"] = False
    pyplot_dict["draw"] = matplotlib.pyplot.draw
    pyplot_dict["figure"] = matplotlib.pyplot.figure
    pyplot_dict["show"] = matplotlib.pyplot.show
    if not nopatch:
        matplotlib.pyplot.draw_if_interactive = draw_if_interactive
        pylab.draw_if_interactive = draw_if_interactive
        matplotlib.pyplot.draw = draw
        matplotlib.pyplot.figure = figure
        matplotlib.pyplot.show = show
        pylab.draw = draw
        pylab.figure = figure
        pylab.show = show

def _gterm_cell_start_hook():
    pyplot_dict["new_cell"] = True
    figure()

def _gterm_cell_end_hook():
    pass

def draw_if_interactive():
    try:
        import matplotlib
        from matplotlib._pylab_helpers import Gcf
        if matplotlib.is_interactive():
            figManager = Gcf.get_active()
            if figManager is not None and figManager.canvas and figManager.canvas.figure:
                retval = display(figManager.canvas.figure, overwrite=(not pyplot_dict["new_plot"]))
                pyplot_dict["new_plot"] = False
                return retval
    except Exception:
        pass

def draw(*args, **kwargs):
    """Wrapper for pyplot.draw
    """
    if not pyplot_dict:
        raise Exception("gmatplot.setup not invoked")
    import matplotlib.pyplot as plt
    retval = display(plt, overwrite=(not pyplot_dict["new_plot"]))
    pyplot_dict["new_plot"] = False
    return retval

def figure(*args, **kwargs):
    """Wrapper for pyplot.figure
    """
    if not pyplot_dict:
        raise Exception("gmatplot.setup not invoked")
    pyplot_dict["new_plot"] = True
    return pyplot_dict["figure"](*args, **kwargs)

def show(*args, **kwargs):
    """Save current figure as a blob and display as block image
    """
    if not pyplot_dict:
        raise Exception("gmatplot.setup not invoked")

    if args:
        overwrite = args[0]
    else:
        overwrite = kwargs.pop("overwrite", not pyplot_dict["new_plot"])
    format = kwargs.pop("format", "svg")
    outfile = kwargs.pop("outfile", "")
    title = kwargs.pop("title", "")
    fullscreen = kwargs.pop("fullscreen", False)

    import matplotlib.pyplot as plt
    retval = display(plt, overwrite=overwrite, format=format, outfile=outfile, title=title, fullscreen=fullscreen)
    pyplot_dict["new_plot"] = False
    return retval

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

def display(fig, overwrite=False, format="png", outfile="", title="", fullscreen=False, max_bytes=25000000):
    """Save figure as a blob and display as block image
    """
    #if not pyplot_dict:
    #    raise Exception("gmatplot.setup not invoked")

    if outfile:
        fig.savefig(outfile, format=format)
        return

    pyplot_dict["drawing"] = True
    try:
        if format=="svg":
            outbuf = StringIO()
            fig.savefig(outbuf, format="svg")
            html = outbuf.getvalue()
            start = html.find('<svg ')
            if start >= 0:
                html = html[start:]
            outbuf.close()
        else:
            content_type = "application/pdf" if format=="pdf" else "image/"+format
            outbuf = BlobBytesIO(max_bytes=max_bytes)
            fig.savefig(outbuf, format=format)
            fig_data = outbuf.close()
            params = ""
            html = '<img %s src="data:%s;base64,%s"/>' % (params, content_type, base64.b64encode(fig_data).decode())
    finally:
        pyplot_dict["drawing"] = False

    ##dtutils.display_blockimg_old(blob_url, overwrite=overwrite, alt=title)
    if pyplot_dict["new_cell"]:
        pyplot_dict["new_cell"] = False
        pyplot_dict["new_plot"] = True
    else:
        dtutils.display_html(html, overwrite=overwrite, name="python_image", inline=False)

def resize_win(dimensions=""):
    """Resize matplotlib default window for terminal"""
    if not pyplot_dict:
        raise Exception("gmatplot.setup not invoked")
    if not dimensions:
        dimensions = dtutils.Dimensions
    if not dimensions:
        return

    try:
        char_dims, sep, pixel_dims = dimensions.partition(";")
        if not pixel_dims:
            return
        width, height = pixel_dims.lower().split("x")
        import matplotlib
        dpi = float(matplotlib.rcParams["figure.dpi"])
        figsize = "%.2f, %.2f" % (0.8*float(width)/dpi, 0.7*float(height)/dpi)
        matplotlib.rcParams["figure.figsize"] = figsize
    except Exception as excp:
        raise Exception("Error in resizing: "+str(excp))

def newfig(*args, **kwargs):
    """New figure
    """
    retval = figure(*args, **kwargs)
    print("")  # Hack: This is needed to make it work. Otherwise previous figure is repeated
    show()
    return retval

def resize_newfig(*args, **kwargs):
    """Resize matplotlib default window for terminal (for new figure)
    """
    resize_win()
    return newfig(*args, **kwargs)

setup()
