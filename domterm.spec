Name:           domterm
Version:        0.74
Release:        1%{?dist}
Summary:        A terminal emulator based on web technologies

License:        BSD
URL:            https://domterm.org/  
%global commit0 6968552cad997b9f70794054f7c93a233ce97700
%global gittag0 HEAD
%global shortcommit0 %(c=%{commit0}; echo ${c:0:7})
Source0:  https://github.com/PerBothner/DomTerm/archive/%{commit0}.tar.gz#/DomTerm-%{commit0}.tar.gz
#Source0: DomTerm.tar.gz
#Source0:        https://github.com/PerBothner/DomTerm/archive/%{version}/DomTerm-%{version}.tar.gz
BuildRequires: autoconf
BuildRequires: automake
BuildRequires: desktop-file-utils
BuildRequires: pkgconfig(libwebsockets)
BuildRequires: pkgconfig(json-c)
BuildRequires: pkgconfig(openssl)
BuildRequires: java-devel
BuildRequires: qt5-qtbase-devel
BuildRequires: qt5-qtwebchannel-devel
BuildRequires: qt5-qtwebengine-devel

Requires:       json-c
Requires(preun): %{_sbindir}/alternatives
Requires(posttrans): %{_sbindir}/alternatives

# The domterm package also includes Java client and server classes
# that are useful for Java applications (for example Kawa).
# It is convenient to put them in the same domterm.jar as the
# much-bigger JavaScript and style files.  However, these Java classes
# are not needed for the ldomterm or qtdomterm applications.
Recommends:     java

%description
A terminal emulator based on web technologies.
You can "print" images, tables, and other HTML forms.
Supports 24-bit color; xterm mouse events; solid xterm emulation.
Good handling of Unicode, CJK wide characters, and IME support.
Experimental builtin pager (like simplified 'less').
Builtin basic input line editor with history.
Styling using CSS.
Hide/unhide a command's output.

%package -n qtdomterm
Summary:        A terminal emulator using Qt and web technologies
# qtdomterm currently uses some GPL-licensed files for the "backend".
# It is likely we will want to remove those backend files, and
# just use ldomterm instead.  But until then ...
License:        GPLv2+
Requires(preun): %{_sbindir}/alternatives
Requires(posttrans): %{_sbindir}/alternatives
%description -n qtdomterm

A terminal emulator using Qt and web technologies

%prep
%autosetup -n DomTerm-%{commit0}

%build
autoreconf
%configure --disable-pty --with-qtwebengine --with-java --with-libwebsockets
%make_build

%install
%make_install
# Let alternatives manage the symlink to %%{_bindir}/domterm
rm %{buildroot}%{_bindir}/domterm

%preun
%{_sbindir}/alternatives --remove domterm %{_bindir}/ldomterm

%preun -n qtdomterm
%{_sbindir}/alternatives --remove domterm %{_bindir}/qtdomterm

%posttrans
%{_sbindir}/alternatives --install %{_bindir}/domterm domterm %{_bindir}/ldomterm 80

%posttrans -n qtdomterm
%{_sbindir}/alternatives --install %{_bindir}/domterm domterm %{_bindir}/qtdomterm 70

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/domterm.desktop %{buildroot}%{_datadir}/applications/qtdomterm.desktop

%files
%{_bindir}/ldomterm
%{_bindir}/dt-util
%dir %{_datadir}/domterm
%{_datadir}/domterm/application.ini
%{_datadir}/domterm/chrome.manifest
%{_datadir}/domterm/defaults/
%{_datadir}/domterm/defaults/preferences/
%{_datadir}/domterm/defaults/preferences/prefs.js
%{_datadir}/domterm/domterm.jar
%{_datadir}/domterm/jdomterm
%{_datadir}/applications/domterm.desktop
%{_datadir}/appdata/domterm.appdata.xml
%{_mandir}/man1/domterm.1*
%{_mandir}/man1/ldomterm.1*
%{_mandir}/man1/dt-util.1*
%license COPYING

%files -n qtdomterm
%{_bindir}/qtdomterm
%{_mandir}/man1/qtdomterm.1*
%{_datadir}/applications/qtdomterm.desktop
%{_datadir}/appdata/qtdomterm.appdata.xml
%license COPYING

%changelog
* Sat Apr  8 2017 Per Bothner <per@bothner.com> - 0.74-1
- Initial version.
