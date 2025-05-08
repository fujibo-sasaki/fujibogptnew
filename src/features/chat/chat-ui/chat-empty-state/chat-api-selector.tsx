import { FC , useState} from "react";
import { ChatAPIModel } from "../../chat-services/models";
import { useChatContext } from "../chat-context";
import { useSession } from "next-auth/react";
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';

interface Prop {
  disable: boolean;
}




export const ChatAPISelector: FC<Prop> = (props) => {
  const { chatBody, onChatAPIModelChange } = useChatContext();
  const [gptModel, setGPTModel] = useState(0);

  
  const { data: session } = useSession();

  const [checked, setChecked] = useState(chatBody.chatAPIModel === "Current_Version" ? false : true);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setChecked(event.target.checked);
    if (checked) {
      onChatAPIModelChange("Current_Version" as ChatAPIModel);
    }else{
      onChatAPIModelChange("Preview_Version" as ChatAPIModel);
    }
   
    };
    return (
      <FormGroup>
        <FormControlLabel  control={
        <Switch
          checked={checked}
          onChange={handleChange}
          inputProps={{ 'aria-label': 'controlled' }}
          disabled={props.disable}
        />
      } label=""　
       />
      </FormGroup>
    );
}
