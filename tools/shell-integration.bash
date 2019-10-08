_prompt_executing=""
function __prompt_precmd() {
    local ret="$?"
    if test "$_prompt_executing" != "0"
    then
      _PROMPT_SAVE_PS1="$PS1"
      _PROMPT_SAVE_PS2="$PS2"
      PS1='\[\e]133;P;k=i\a\]'$PS1'\[\e]133;B\a\e]122;> \a\]'
      PS2='\[\e]133;P;k=c\a\]'$PS2'\[\e]133;B\a\]'
    fi
    if test "$_prompt_executing" != ""
    then
      printf "\033]133;D;%s;aid=%s\007" "$ret" "$BASHPID"
    fi
    printf "\033]133;A;cl=m;aid=%s\007" "$BASHPID"
    _prompt_executing=0
}
function __prompt_preexec() {
    PS1="$_PROMPT_SAVE_PS1"
    PS2="$_PROMPT_SAVE_PS2"
    printf "\033]133;C;\007"
    _prompt_executing=1
}
preexec_functions+=(__prompt_preexec)
precmd_functions+=(__prompt_precmd)
