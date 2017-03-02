Name:           domterm
Version:        0.71
Release:        1%{?dist}
Summary:        A terminal emulator based on web technologies

License:        BSD
URL:            http://domterm.org/  
#Source0:        DomTerm-master.tar.gz
Source0:        https://github.com/PerBothner/DomTerm/archive/%{version}/DomTerm-%{version}.tar.gz
#Source0:        https://github.com/PerBothner/DomTerm/archive/%{commit0}.tar.gz

BuildRequires:  autoconf automake pkgconfig(libwebsockets) pkgconfig(json-c) pkgconfig(openssl) java-devel
BuildRequires:  qt5-qtbase-devel qt5-qtwebchannel-devel qt5-qtwebengine-devel
Requires:       json-c
Requires(preun): %{_sbindir}/alternatives
Requires(posttrans): %{_sbindir}/alternatives

%global commit0 574e37bbda5b64ea93327cef45e44f744d8b2132
%global gittag0 master
%global shortcommit0 %(c=%{commit0}; echo ${c:0:7})

%description
A terminal emulator based on web technologies

%package -n qtdomterm
Summary:        A terminal emulator using Qt and web technologies
License:        BSD
Requires:  qt5-qtbase qt5-qtwebchannel qt5-qtwebengine
Requires(preun): %{_sbindir}/alternatives
Requires(posttrans): %{_sbindir}/alternatives
%description -n qtdomterm

A terminal emulator using Qt and web technologies

%prep
%autosetup -n DomTerm-%{version}

%build
autoreconf
%configure --disable-pty --with-qtwebengine --with-java --with-libwebsockets
%make_build

%install
make DESTDIR=$RPM_BUILD_ROOT install
# Let alternatives manage the symlink
echo after install link %{buildroot}%{_bindir}/domterm
rm %{buildroot}%{_bindir}/domterm

%preun
%{_sbindir}/alternatives --remove domterm %{_bindir}/ldomterm

%preun -n qtdomterm
%{_sbindir}/alternatives --remove domterm %{_bindir}/qtdomterm

%posttrans
%{_sbindir}/alternatives --install %{_bindir}/domterm domterm %{_bindir}/ldomterm 80

%posttrans -n qtdomterm
%{_sbindir}/alternatives --install %{_bindir}/domterm domterm %{_bindir}/qtdomterm 70

%files
%{_bindir}/ldomterm
%dir %{_datadir}/domterm
%{_datadir}/domterm/application.ini
%{_datadir}/domterm/chrome.manifest
%{_datadir}/domterm/defaults/preferences/prefs.js
%{_datadir}/domterm/domterm.jar
%{_mandir}/man1/domterm.1*
%{_mandir}/man1/ldomterm.1*

%files -n qtdomterm
%{_bindir}/qtdomterm
%{_mandir}/man1/qtdomterm.1*

%changelog
* Wed Mar  1 2017 Per Bothner <per@bothner.com> 0.72-1
- Various tweaks based on feedback.

* Sun Feb 19 2017 Per Bothner <per@bothner.com> 0.71-1
- Initial version.
