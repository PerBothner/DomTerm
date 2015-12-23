<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="1.0">
  <!--<xsl:import href="html/chunktoc.xsl"/>-->
<xsl:import href="chunkfast.xsl"/>
<xsl:import href="docbook-to-html.xsl"/>

<xsl:param name="html.namespace"></xsl:param>
<!-- Dummy - not actually used, except needs to be non-empty,
     so output.html.stylesheets gets called. -->
<xsl:param name="html.stylesheet">style/domterm-l.css</xsl:param>
<xsl:param name="html.script">style/utils.js</xsl:param>

<xsl:template name="output.html.stylesheets">
  <xsl:variable name="href">
    <xsl:call-template name="relative.path.link">
      <xsl:with-param name="target.pathname" select="Community.html"/>
    </xsl:call-template>
  </xsl:variable>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" title="DomTerm (navbar: fixed, left)"
  href="{$href}style/domterm-l.css"  media="(min-width: 600px)"/>
<link rel="alternate stylesheet" title="DomTerm (navbar: fixed, right)"
  href="{$href}style/domterm-r.css" media="(min-width: 600px)"/>
<link rel="alternate stylesheet" title="Single column, top navigation" href="{$href}style/domterm-1col.css"/>
</xsl:template>

<xsl:template name="body.attributes">
  <xsl:attribute name="bgcolor">white</xsl:attribute>
  <xsl:attribute name="text">black</xsl:attribute>
  <xsl:attribute name="link">#0000FF</xsl:attribute>
  <xsl:attribute name="vlink">#840084</xsl:attribute>
  <xsl:attribute name="alink">#0000FF</xsl:attribute>
  <xsl:attribute name="onload">javascript:onLoadHandler();</xsl:attribute>
  <xsl:attribute name="onunload">javascript:onUnloadHandler();</xsl:attribute>
  </xsl:template>

<!-- Change metatitle (window titlebar) to "DomTerm: PAGE-TITLE" -->
<xsl:template match="*" mode="object.title.markup.textonly">
  <xsl:variable name="title">
    <xsl:apply-templates select="." mode="object.title.markup"/>
  </xsl:variable>DomTerm: <xsl:value-of select="normalize-space($title)"/>
</xsl:template>

<xsl:template name="extra.header.navigation">
  <ul>
    <li><a href="index.html">DomTerm home</a></li>
  </ul>
  </xsl:template>

<!-- Same as in common/common.xsl except for using $object/title. -->
<xsl:template name="object.id">
  <xsl:param name="object" select="."/>
  <xsl:choose>
    <xsl:when test="$object/@id">
      <xsl:value-of select="$object/@id"/>
    </xsl:when>
    <xsl:when test="$object/@xml:id">
      <xsl:value-of select="$object/@xml:id"/>
    </xsl:when>
    <!-- If $object has a title child, use that. -->
    <xsl:when test="$object/title">
      <xsl:value-of select="translate($object/title,' ','-')"/>
    </xsl:when>
    <xsl:otherwise>
      <xsl:value-of select="generate-id($object)"/>
    </xsl:otherwise>
  </xsl:choose>
</xsl:template>

<xsl:template name="user.header.logo">
  <div class="logo"><a href="index.html">DomTerm</a></div>
</xsl:template>

</xsl:stylesheet>
