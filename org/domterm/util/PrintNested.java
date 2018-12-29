package org.domterm.util;
import java.io.*;
import java.util.*;

/* https://news.ycombinator.com/item?id=17307123
*/

/** Convenience class for pretty-printing structured data, with folding.
 * The class can be used as-is, or you can customize it by extending it.
 *
 * This class handles nested objects that can be a mix of:
 * - Lists (java.util.List objects): A sequence of values, each prefixed
 *   with an integer index, surrounded by "[" and "]".
 * - Maps (java.util.Map objects): A sequence of values, each prefixed
 *   with a key (commonly a string), surrounded by "[" and "]".
 * - Trees (the Tree interface in this class): A header object (commonly a
 *   string, followed by one of more children.
 */

public class PrintNested
{
    /** Demo/test method. */
    public static void main(String[] args) {
        PrintWriter out = new PrintWriter(System.out);
        PrintNested pn = new PrintNested(out);
        LinkedHashMap<Object,Object> map1 = new LinkedHashMap<Object,Object>();
        map1.put("key1", 98789767);
        map1.put("key2", "abcdefghijklmnopqrstuvwxyz");
        Object obj =
            pn.makeTree("info: GET /foo/endpoint",
                        "info: user <user ID> valid auth",
                        map1,
                        Arrays.asList(
                                      3, 4,
                                      pn.makeTree("info1 - request to service A",
                                                  "info1a - request took 1 seconds",
                                                  "info1b - request took 1 seconds"),
                                      "info2",
                                      Arrays.asList(11099011,
                                                    Arrays.asList(13008821,
                                                                  13008822),
                                                    12099012)
                                      ),
                        pn.makeTree("info3 - request to service B",
                                    "debug - opening new connection\nnext line",
                                    "debug - success, result = ...",
                                    "info - request took 1 seconds"),
                        "info - http request took 3 seconds abcdefghi",
                        "info - preparing result took 1 seconds"
                        );
        pn.printObject(obj, false);
        out.println();
        out.flush();
    }

    protected PrintWriter out;
    protected boolean isDomTerm;

    public static final int NL_LINEAR = 116;
    public static final int NL_FILL = 115;
    public static final int NL_MISER = 117;
    public static final int NL_MANDATORY = 118;

    /** Where hide/show (folding) buttons are printed.
     * If false, buttons are printed between header and children.
     * (This is probably more "logical".)
     * If true, buttons are printed before header.
     * (This does print the parts in a less logical order,
     * but it looks pretty and may be more familiar.)
     */
    public boolean prefixButtons = true;

    /* The character icon to use for the "hide" button.
     * The default is “black down-pointing triangle”.
     * Must be a single Unicode code point. */
    public String hideButtonChar = "\u25BC";

    /* The character icon to use for the "show" button.
     * The default is “black right-pointing triangle”.
     * Must be a single Unicode code point. */
    public String showButtonChar = "\u25B6";

    /** Horional line.
     * Defaults to x2500 "box drawings light horizontal". */
    public String boxHorizonal = "\u2500";
    /** Vertical line.
     * Defaults to x2502 "box drawings light vertical". */
    public String boxVertical = "\u2502";
    /** Vertical line for last child.
     * Defaults to x250a "box drawings light quadruple dash vertical". */
    public String boxVerticalLast = "\u250a";
    /** Left "margin" to indicate a child element (except the last one).
     * Defaults to x251C "box drawings light vertical and right". */
    public String boxChild = "\u251C";
    /** Left "margin" to indicate the last child element.
     * Defaults to x2514 "box drawings light up and right". */
    public String boxChildLast = "\u2514";
    public String nobreakSeparator = " " + boxChild;

    /** How many columns to indent for each nesting level.
     * Must be at least 1.  */
    public int indentStep = 2;

    private StringBuilder indentation = new StringBuilder();
    private Stack<Integer> indentationLengthStack = new Stack<Integer>();

    public PrintNested(PrintWriter out) {
        this.out = out;
        this.isDomTerm = System.console() != null
            && System.getenv("DOMTERM") != null;
    }

    /** A generalized tree node.
     */
    public static interface Tree {
        Object getHeader();
        Iterable getChildren();
    };

    /** A simple implementation of Tree. */
    public static class SimpleTree implements Tree {
        Object header;
        List children;
        public Object getHeader() { return header; }
        public Iterable getChildren() { return children; }
    }

    /** Create a Tree from the given arguments. */
    public Tree makeTree(Object header, Object... children) {
        SimpleTree node = new SimpleTree();
        node.header = header;
        node.children = Arrays.asList(children);
        return node;
    }

    public boolean isTree(Object obj) {
        return obj instanceof Tree;
    }
    public boolean isList(Object obj) {
        return obj instanceof List;
    }
    public void startLogicalBlock() {
        if (isDomTerm)
            out.print("\033]110\007");
        else {
            indentationLengthStack.add(indentation.length());
        }
    }
    public void endLogicalBlock() {
        if (isDomTerm)
            out.print("\033]111\007");
        else {
            indentation.setLength(indentationLengthStack.pop());
        }
    }
    public void printSimple(Object obj) {
        out.print(obj == null ? "(null)" : obj.toString());
    }
    public void newline(int kind) {
        out.print("\033]"+kind+"\007");
    }

    public void printObject(Object obj, boolean element) {
        if (isList(obj) || obj instanceof Map) {
            if (prefixButtons && ! element)
                printHideButton();
            if (isList(obj))
                printList(obj);
            else
                printMap(obj);
        } else if (isTree(obj)) {
            if (prefixButtons && ! element)
                printHideButton();
            printTree((Tree) obj);
        } else {
            printSimple(obj);
        }
    }
    public void printElementSeparator(String nobreak, boolean last) {
        String postbreak = (last ? boxChildLast : boxChild)
            + repeat(boxHorizonal,indentStep-1);
        if (isDomTerm) {
            int kindCode = NL_LINEAR;
            out.print("\033]"+kindCode+";\"\",\""+postbreak+"\","+nobreak+"\007");
        } else {
            out.print("\n" + indentation + postbreak);
        }
    }
    public void printHideButton() {
        if (isDomTerm)
            out.print("\033[16u"+hideButtonChar+showButtonChar+"\033[17u");
    }

    protected void printIndentation(boolean last) {
        // negative indentation to compensate for the 'postbreak' string.
        String indent = (last ? boxVerticalLast : boxVertical)
            + repeat(" ", indentStep-1);
        if (isDomTerm) {
            out.print("\033]112;"+(-indentStep)+"\007");
            out.print("\033]114;\""+indent+"\"\007"); // indentation
        } else {
            indentation.append(indent);
        }
    }

    public void printTree(Tree obj) {
        out.print(obj.getHeader());
        if (! prefixButtons)
            printHideButton();
        Iterator it = obj.getChildren().iterator();
        boolean first = true;
        boolean more = it.hasNext();
        while (more) {
            Object child = it.next();
            more = it.hasNext();
            printElementSeparator("\""+boxChild+"\"", ! more);
            first = false;
            startLogicalBlock();
            printIndentation(!more);
            printObject(child, false);
            endLogicalBlock();
        }
    }

    public void printListHeader(List obj) {
        out.print("array("+obj.size()+")[");
    }
    public void printListTail() {
        out.print("]");
    }
    public void printMapHeader(Map obj) {
        out.print("{");
    }
    public void printMapTail() {
        out.print("}");
    }

    protected void printKey(Object key) {
        if (key != null) {
            out.print(key.toString()+":");
            if (isDomTerm)
                out.print("\033]"+NL_FILL+";\"\",\"\",\" \"\007");
            else
                out.print(" ");
        }
    }

    protected void printElement(Object key, Object obj,
                                boolean first, boolean last) {
        printElementSeparator(first ? "\"\"" : "\";\"", last);
        startLogicalBlock();
        printIndentation(last);
        boolean isList = isList(obj);
        boolean isTree = isTree(obj);
        boolean isMap = obj instanceof Map;
        if (prefixButtons) {
            if (isList || isTree || isMap)
                printHideButton();
            else if (isDomTerm)
                out.print(" ");
        }
        printKey(key);
        printObject(obj, true);
        endLogicalBlock();
    }

    public void printList(Object arg) {
        List obj = (List) arg;
        printListHeader(obj);
        if (! prefixButtons)
            printHideButton();
        Iterator it = obj.iterator();
        boolean more = it.hasNext();
        boolean first = true;
        int index = 0;
        while (more) {
            Object child = it.next();
            more = it.hasNext();
            printElement(Integer.valueOf(index), child, first, !more);
            first = false;
            index++;
        }
        printListTail();
    }
    public void printMap(Object arg) {
        Map obj = (Map) arg;
        printMapHeader(obj);
        if (! prefixButtons)
            printHideButton();
        Iterator it = obj.entrySet().iterator();
        boolean more = it.hasNext();
        boolean first = true;
        int index = 0;
        while (more) {
            Map.Entry child = (Map.Entry) it.next();
            more = it.hasNext();
            printElement(child.getKey(), child.getValue(), first, !more);
            first = false;
            index++;
        }
        printMapTail();
    }
    private static String repeat(String str, int count) {
        StringBuilder sb = new StringBuilder();
        while (--count >= 0)
            sb.append(str);
        return sb.toString();
    }
}
