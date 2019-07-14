if status --is-interactive
  set _fishprompt_aid "fish"$fish_pid
  set _fishprompt_started 0
  set _fishprompt_executing 0
  set _fishprompt_postexec 0

  functions -c fish_prompt _fishprompt_saved_prompt
 
  function _fishprompt_start --on-event fish_prompt
    echo  _fishprompt_start >>/tmp/flog
  end

  function fish_prompt
    set -l last_status $status
    set -l xargs ""
    # don't use post-exec, because it is called *before* omitted-newline output
    if [ "$_fishprompt_postexec" = "1" ]
      printf "\033]133;Z;exitcode=%s;aid=%s\007" $last_status $_fishprompt_aid
    else if [ "$_fishprompt_started" = "1" ]
      set xargs "repaint;"
    end
    set _fishprompt_executing 0
    printf "\033]133;A;%said=%s;click-move=multi\007" $xargs $_fishprompt_aid
    printf "%b\033]133;B\007" (string join "\n" (_fishprompt_saved_prompt))
    set _fishprompt_started 1
    set _fishprompt_postexec 0
  end

  #function _fishprompt_not_found --on-event fish_command_not_found
  #end

  function _fishprompt_preexec --on-event fish_preexec
    if [ "$_fishprompt_started" = "1" ]
      printf "\033]133;C;\007"
    end
    set _fishprompt_started 0
    set _fishprompt_executing 1
  end

  function _fishprompt_postexec --on-event fish_postexec
     set _fishprompt_postexec 1
  end

  functions -c __fish_cancel_commandline _fishprompt_saved_cancel
  function __fish_cancel_commandline
    _fishprompt_saved_cancel $argv
    printf "\033]133;Z;cancel;aid=%s\007" $_fishprompt_aid
    set _fishprompt_started 0
    set _fishprompt_postexec 0
  end

  function _fishprompt_exit --on-process %self
    if [ "$_fishprompt_started" = "1" ]
      printf "\033]133;Z;aid=%s\007" $_fishprompt_aid
    end
  end

  if functions -q fish_right_prompt
    functions -c fish_right_prompt _fishprompt_saved_right_prompt
    function fish_right_prompt
       printf "\033]133;P;kind=right\007%b\033]133;B\007" (string join "\n" (_fishprompt_saved_right_prompt))
    end
  end
 end
