memory = {'previous chat summary':[], 'current chat':[]}

def main():
    memory_id = show_memory() #show summarized memory and get input 'memory_id' 
    chat(content_id, memory_id) #constantly summarize

def chat(content_id, memory_id):
    memory['current chat'] = []
    memory['previous chat summary']=get_memory(memory_id)
    while True:
        request = get_request_from_user() #for further develop, online!
        if request in ['exit', 'quit']:
            break
        response = send_request(memory)
        show_response_to_user(response) #for further develop, online!
        memory['current chat'] = put_memory(memory['current chat'], request, response)
        if len(memory['current chat']) == 4:
            memory['previous chat summary'] = summarize_chat(memory['previous chat summary'], memory['current chat'])
            memory['current chat'] = []
    save_memory(memory['previous chat summary'], memory['current chat'])

def show_memory(): #can 
    return

def get_memory(memory_id):
    return

def get_request_from_user(): 
    return

def send_request(memory):
    return

def show_response_to_user(response): 
    return

def summarize_chat():
    return

def save_memory():
    return

def put_memory(current_chat_memory, request, response): #put in database, too
    return

