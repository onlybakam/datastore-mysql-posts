import { useEffect, useState, useRef } from 'react'
import config from './aws-exports'
import Amplify, { DataStore } from 'aws-amplify'
import { Post, Comment } from './models'
import { useKeyPressEvent, useUpdateEffect } from 'react-use'

Amplify.configure(config)

function App() {
  const [posts, setPosts] = useState([])
  const [title, setTitle] = useState('')
  useEffect(() => {
    const subscription = DataStore.observe(Post).subscribe((msg) => {
      DataStore.query(Post).then((posts) => setPosts(posts))
    })
    DataStore.query(Post).then(setPosts)

    return () => subscription && subscription.unsubscribe()
  }, [])

  const createPost = async (event) => {
    event.preventDefault()
    await DataStore.save(new Post({ title }))
    setTitle('')
  }

  return (
    <div className="p-4 App">
      <div>
        <form onSubmit={createPost}>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700"
          >
            New Post
          </label>
          <div className="mt-1">
            <input
              type="text"
              name="title"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="new post"
            />
          </div>
        </form>
      </div>
      <div className="mt-4 overflow-hidden bg-white shadow sm:rounded-md">
        <div className="divide-y divide-gray-200">
          {posts.map((post) => (
            <LI key={post.id} post={post} />
          ))}
        </div>
      </div>
    </div>
  )
}

const LI = ({ post }) => {
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState(post.title)
  const [comments, setComments] = useState([])
  const ref = useRef(null)
  const predicate = (event) => {
    const match = event.key === 'Escape' && event.target === ref.current
    if (match) {
      console.log(`it's a match. event >`, JSON.stringify(event, null, 2))
    }
    return match
  }

  useEffect(() => {
    if (!post) return
    DataStore.query(Comment).then((cs) =>
      setComments(cs.filter((c) => c.postID === post.id))
    )
  }, [post])

  const handler = () => {
    setEdit(false)
  }

  const activate = (event) => {
    if (edit) return
    setEdit(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    console.log(event)
    ref.current.blur()
    setEdit(false)
    await DataStore.save(
      Post.copyOf(post, (updated) => {
        updated.title = title
        updated.mysql_id = post.mysql_id
      })
    )
  }

  const doDelete = async (event) => {
    event.preventDefault()
    await DataStore.delete(post)
  }

  const addComment = async () => {
    const content = prompt('Add a Comment')
    await DataStore.save(new Comment({ content, postID: post.id }))
  }

  useKeyPressEvent(predicate, handler)

  useUpdateEffect(() => {
    ref.current.focus()
  }, [edit])

  return (
    <div>
      <div className="flex items-center px-4 py-4 sm:px-6">
        <div className="flex items-center flex-1 min-w-0">
          <div className="flex-shrink-0">
            <button
              onClick={addComment}
              type="button"
              className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <svg
                className="w-5 h-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          <div className="items-center flex-1 min-w-0 px-4 md:grid md:grid-cols-3 md:gap-4">
            <div onClick={activate}>
              <p
                className={`${
                  edit ? 'hidden' : ''
                } text-sm font-medium text-indigo-600 truncate py-2 px-3 border border-transparent`}
              >
                {post.title}
              </p>
              <form onSubmit={submit}>
                <input
                  ref={ref}
                  onBlur={() => setEdit(false)}
                  type="text"
                  name="title"
                  id="title"
                  className={`${
                    !edit ? 'hidden' : ''
                  } shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={post.title}
                />
              </form>
            </div>
            <div className="hidden md:block">
              <div>
                <ul className="font-mono text-sm text-gray-900 ">
                  <li>id: {post.id}</li>
                  <li>mysql_id: {post.mysql_id}</li>
                  <li>version: {post._version}</li>
                  <li>
                    Updated:{' '}
                    {new Date(post._lastChangedAt * 1000).toLocaleString()}
                  </li>
                </ul>
              </div>
            </div>
            <div className="hidden md:block">
              <div>
                <p className="text-sm text-gray-900">
                  Comments: {comments.length}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div>
          <button
            onClick={doDelete}
            className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-red-400 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <svg
              className="w-5 h-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex items-center px-4 py-4 sm:px-6">
        {comments.map((comment) => (
          <span>{comment.content}</span>
        ))}
      </div>
    </div>
  )
}

export default App
